import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { gateway } from './agentGateway.ts'
import type { AgentToCloud, CloudToAgent } from './agentProtocol.ts'
import { initStore } from './authStore.ts'
import { migrate, dbEnabled } from './db.ts'
import { startScheduler } from './scheduler.ts'
import { createJob, listJobs, getJob, activeRefIds } from './jobStore.ts'
import { importSnapshot, getOrgState, orgHasData } from './stateStore.ts'
import { orchestrateMeeting, getMeeting, isMeetingRunning, orgHasExecutor, recoverMeetings, type MeetingRunPayload } from './meetingRunner.ts'
import { addBusConn, notifyOrg } from './bus.ts'
import {
  changePassword,
  createMember,
  login,
  openRoot,
  orgFromToken,
  orgUsers,
  registerRoot,
  requireAuth,
  requireRoot,
  setMemberDisabled,
  signAgentToken,
  signEnrollToken,
  verifyAgentToken,
  verifyEnrollToken,
  type AuthedRequest,
} from './auth.ts'

// ── OPC 后端骨架 ──────────────────────────────────────────────
// 架构：内网机器上的常驻 agent 出站建 WSS 长连接 → AgentGateway 管理连接、
//        注册、心跳、派单、回传中继。云端不主动连入内网机器。
//
// 里程碑 1：前台用 mock 驱动。
// 里程碑 2：接入真实 agent —— 在 /agent 挂 WebSocket 服务器，把每条连接包成
//           AgentConnection 交给 gateway；派单走 gateway.dispatch()。

initStore()

// 云端持久层 + 常驻调度器（关页面不中断的核心）
if (dbEnabled) {
  migrate()
    .then(startScheduler)
    .then(async () => {
      const n = await recoverMeetings().catch(() => 0)
      if (n) console.log(`↻ 恢复 ${n} 场中断的会议编排`)
    })
    .catch((e) => console.error('✗ DB 初始化失败：', (e as Error).message))
} else {
  console.warn('⚠ 未配置 DATABASE_URL，云端调度未启用（仍可用旧的前端直连派单）')
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '32mb' })) // 领域数据快照可达数 MB

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'opc-backend', agents: gateway.listMachines().length })
})

// ── 鉴权 ──────────────────────────────────────────────────
// 账户组（org）= Root + 成员；每个 org 是隔离工作区。bcrypt 存密码，JWT 无状态会话。

// 注册（= 开一个新的 Root 账号 + 独立账户组）
app.post('/api/auth/register', (req, res) => {
  try {
    res.json(registerRoot(req.body ?? {}))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// 登录
app.post('/api/auth/login', (req, res) => {
  try {
    res.json(login(req.body ?? {}))
  } catch (err) {
    res.status(401).json({ error: (err as Error).message })
  }
})

// 当前用户（校验 token）
app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.auth!.user })
})

// 修改自己的密码
app.post('/api/auth/password', requireAuth, (req: AuthedRequest, res) => {
  try {
    changePassword(req.auth!.user.id, req.body?.currentPassword, req.body?.newPassword)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// 登出（无状态 JWT，客户端丢弃 token 即可；此处仅回执）
app.post('/api/auth/logout', (_req, res) => {
  res.json({ ok: true })
})

// 本账户组成员列表
app.get('/api/org/users', requireAuth, (req: AuthedRequest, res) => {
  res.json({ users: orgUsers(req.auth!.user.orgId) })
})

// root 在本账户组内新增成员
app.post('/api/org/members', requireAuth, requireRoot, (req: AuthedRequest, res) => {
  try {
    res.json({ user: createMember(req.auth!.user.orgId, req.body ?? {}) })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// root 停用/启用本账户组内成员
app.post('/api/org/members/:id/disabled', requireAuth, requireRoot, (req: AuthedRequest, res) => {
  try {
    const disabled = req.body?.disabled !== false
    res.json({ user: setMemberDisabled(req.auth!.user.id, req.auth!.user.orgId, String(req.params.id), disabled) })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// 「给用户开 Root 账号」：创建一个独立账户组及其 Root 用户
app.post('/api/admin/roots', requireAuth, requireRoot, (req: AuthedRequest, res) => {
  try {
    res.json({ user: openRoot(req.body ?? {}) })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// ── 本地算力（真实 agent 接入）─────────────────────────────
// 「绑定电脑」：为当前账户组签发 enroll token（无状态 JWT，永不过期）
app.post('/api/machines/enroll-token', requireAuth, (req: AuthedRequest, res) => {
  const token = signEnrollToken(req.auth!.user.orgId)
  res.json({ token, expiresInSec: 0 }) // expiresInSec=0 表示永不过期
})

// 本账户组在线机器与执行器
app.get('/api/machines', requireAuth, (req: AuthedRequest, res) => {
  const orgId = req.auth!.user.orgId
  res.json({ machines: gateway.listMachines().filter((m) => m.accountId === orgId) })
})

// 删除（解绑）一台机器：关闭其 agent 连接并移除。仅限本账户组。
app.delete('/api/machines/:machineId', requireAuth, (req: AuthedRequest, res) => {
  const machineId = String(req.params.machineId)
  if (gateway.orgOf(machineId) !== req.auth!.user.orgId) {
    return res.status(404).json({ error: '机器不存在或不属于你的账户组' })
  }
  gateway.remove(machineId)
  res.json({ ok: true })
})

/** 在某执行器上跑一段 prompt 并等待结果（= 该电脑上的 claude -p）。仅限本账户组的执行器。 */
app.post('/api/agent/run', requireAuth, async (req: AuthedRequest, res) => {
  const { executorId, prompt, cwd } = req.body ?? {}
  if (!executorId || !prompt) return res.status(400).json({ error: 'executorId 和 prompt 必填' })
  const orgId = req.auth!.user.orgId
  const owner = gateway.listMachines().find((m) => m.accountId === orgId && m.executors.some((e) => e.id === executorId))
  if (!owner) return res.status(404).json({ error: '执行器不在线或不属于你的账户组' })
  try {
    // 真实 claude 任务常需数分钟，放宽到 10 分钟
    const out = await gateway.runJob(executorId, prompt, cwd, 600_000)
    res.json({ ok: true, ...out })
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
})

/** 流式派单：派单后把执行器回传的会话内容(chunk/done/error)以 SSE 实时推给前端 */
app.post('/api/agent/run-stream', requireAuth, (req: AuthedRequest, res) => {
  const { executorId, prompt, cwd, planMode } = req.body ?? {}
  if (!executorId || !prompt) return res.status(400).json({ error: 'executorId 和 prompt 必填' })
  const orgId = req.auth!.user.orgId
  const owner = gateway.listMachines().find((m) => m.accountId === orgId && m.executors.some((e) => e.id === executorId))
  if (!owner) return res.status(404).json({ error: '执行器不在线或不属于你的账户组' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const write = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  let jobId = ''
  let chunks = 0
  let idle: NodeJS.Timeout
  const IDLE_MS = 180_000 // 180s 无任何回传即判定卡住
  const armIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      console.log(`⏱ run-stream ${jobId}: 180s 无响应，中断（收到 ${chunks} chunks）`)
      write({ t: 'error', error: '执行器 180 秒无响应（claude 可能卡在权限/信任提示，或未产出）。已中断。' })
      finish()
    }, IDLE_MS)
  }
  const onJob = (e: { type: string; jobId: string; text?: string; result?: string; error?: string }) => {
    if (e.jobId !== jobId) return
    armIdle()
    if (e.type === 'chunk') {
      chunks++
      write({ t: 'chunk', text: e.text })
    } else if (e.type === 'done') {
      console.log(`✓ run-stream ${jobId} 完成 · ${chunks} chunks · result ${e.result?.length ?? 0} 字 (org=${orgId} exec=${executorId})`)
      write({ t: 'done', result: e.result })
      finish()
    } else if (e.type === 'error') {
      console.log(`✗ run-stream ${jobId} 报错: ${e.error} (org=${orgId} exec=${executorId})`)
      write({ t: 'error', error: e.error })
      finish()
    }
  }
  const finish = () => {
    clearTimeout(idle)
    gateway.off('job', onJob)
    if (!res.writableEnded) res.end()
  }
  // 先注册监听，再派单——否则执行器回传很快时事件会在注册前就 emit 掉（监听数=0）
  gateway.on('job', onJob)
  try {
    jobId = gateway.dispatch(executorId, prompt, cwd, planMode ? 'plan' : undefined).jobId
    const firstLine = String(prompt).split('\n').find((l) => l.trim()) ?? ''
    console.log(`▶ run-stream ${jobId} 派单 · prompt ${String(prompt).length}字 · ${firstLine.slice(0, 50)} (org=${orgId})`)
  } catch (err) {
    gateway.off('job', onJob)
    write({ t: 'error', error: (err as Error).message })
    return res.end()
  }
  armIdle()
  // 用 res 的 close（客户端断开）清理，避免 req.close 过早触发移除监听
  res.on('close', () => {
    clearTimeout(idle)
    gateway.off('job', onJob)
  })
})

// ── 云端调度 jobs：入队后由后端 worker 常驻执行，关页面不中断 ──────────
// 入队一批 job（前端把要跑的任务/发言拼好 prompt 后提交）
app.post('/api/jobs', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(503).json({ error: '云端调度未启用（后端缺 DATABASE_URL）' })
  const orgId = req.auth!.user.orgId
  const list = Array.isArray(req.body?.jobs) ? req.body.jobs : []
  if (list.length === 0) return res.status(400).json({ error: 'jobs 为空' })
  try {
    // 去重：对已有「排队中/运行中」job 的 refId 跳过，防双击/多设备重复入队
    const active = new Set(await activeRefIds(orgId))
    const created = []
    let skipped = 0
    for (const j of list) {
      if (!j?.prompt) continue
      if (j.refId && active.has(j.refId)) { skipped++; continue }
      if (j.refId) active.add(j.refId) // 同一批内也去重
      created.push(
        await createJob({
          orgId,
          kind: String(j.kind ?? 'adhoc'),
          refType: j.refType ?? null,
          refId: j.refId ?? null,
          title: j.title ?? '',
          prompt: String(j.prompt),
          mode: j.mode ?? null,
          meta: j.meta ?? null,
        }),
      )
    }
    if (created.length) notifyOrg(orgId, 'jobs') // 入队即推，客户端立刻标记「云端执行中」
    res.json({ ok: true, jobs: created.map((c) => ({ id: c.id, refId: c.ref_id, status: c.status })), skipped })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 查询本账户组的 jobs（?refId= / ?status=），前端轮询进度
app.get('/api/jobs', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.json({ jobs: [] })
  try {
    const jobs = await listJobs(req.auth!.user.orgId, {
      refId: req.query.refId ? String(req.query.refId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    })
    res.json({ jobs })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 单个 job 详情
app.get('/api/jobs/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(404).json({ error: '未启用' })
  const job = await getJob(String(req.params.id))
  if (!job || job.org_id !== req.auth!.user.orgId) return res.status(404).json({ error: 'job 不存在' })
  res.json({ job })
})

// ── 领域数据上云：导入 / 全量读取 ──────────────────────────────
// 一次性把浏览器 store 快照导入本账户组（幂等）
app.post('/api/import', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(503).json({ error: '云端存储未启用' })
  try {
    const result = await importSnapshot(req.auth!.user.orgId, req.body?.snapshot ?? {})
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 读取本账户组全量领域数据（前端 hydrate）
app.get('/api/state', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(503).json({ error: '云端存储未启用' })
  try {
    res.json(await getOrgState(req.auth!.user.orgId))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 本账户组云端是否已有数据（前端判断要不要首次同步）
app.get('/api/state/meta', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.json({ enabled: false, hasData: false })
  res.json({ enabled: true, hasData: await orgHasData(req.auth!.user.orgId) })
})

// ── 云端会议编排：开始会议（后端常驻编排，关页面不中断）+ 轮询状态 ──────────
app.post('/api/meetings/:id/run', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(503).json({ error: '云端会议未启用' })
  const orgId = req.auth!.user.orgId
  const payload = req.body as MeetingRunPayload
  const mid = String(req.params.id)
  if (!payload?.meeting || payload.meeting.id !== mid) return res.status(400).json({ error: 'meeting 负载不合法' })
  if (isMeetingRunning(mid)) return res.status(409).json({ error: '该会议正在进行中' })
  if (!orgHasExecutor(orgId)) return res.status(400).json({ error: '没有在线的本地算力，无法开会' })
  // 异步编排，立即返回；前端轮询 /api/meetings/:id 看进度
  void orchestrateMeeting(orgId, payload)
  res.json({ ok: true, running: true })
})

app.get('/api/meetings/:id', requireAuth, async (req: AuthedRequest, res) => {
  if (!dbEnabled) return res.status(404).json({ error: '未启用' })
  const meeting = await getMeeting(req.auth!.user.orgId, String(req.params.id))
  if (!meeting) return res.status(404).json({ error: '会议不存在' })
  res.json({ meeting, running: isMeetingRunning(String(req.params.id)) })
})

const PORT = Number(process.env.PORT) || 8787
const server = app.listen(PORT, () => {
  console.log(`✓ OPC backend (auth + agent gateway) on http://localhost:${PORT}`)
})

// ── /ws 客户端 WebSocket：前端订阅账户组变更（job/会议完成即时推送）──────────
// 注意：两个 WS 服务器共用一个 http server，必须用 noServer + 单一 upgrade 路由，
// 否则各自监听 upgrade 会相互干扰（RSV1 帧错误）。
const clientWss = new WebSocketServer({ noServer: true })
clientWss.on('connection', (ws) => {
  let removeConn: (() => void) | null = null
  const closeIdle = setTimeout(() => ws.close(), 10_000) // 10s 内未鉴权则关
  ws.on('message', (raw) => {
    let msg: { t?: string; token?: string }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.t === 'auth' && !removeConn) {
      const orgId = msg.token ? orgFromToken(msg.token) : null
      if (!orgId) {
        ws.send(JSON.stringify({ t: 'error', error: '鉴权失败' }))
        ws.close()
        return
      }
      clearTimeout(closeIdle)
      removeConn = addBusConn({ orgId, send: (s) => ws.send(s) })
      ws.send(JSON.stringify({ t: 'ready' }))
    }
  })
  const drop = () => {
    clearTimeout(closeIdle)
    removeConn?.()
  }
  ws.on('close', drop)
  ws.on('error', drop)
})

// ── /agent WebSocket：内网 agent 出站接入的落点 ───────────────
// agent 出站建 wss 长连接 → 首帧 enroll → attach → heartbeat / job 回传中继。
const wss = new WebSocketServer({ noServer: true })

// 单一 upgrade 路由：按路径分发到对应的 WS 服务器
server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '').split('?')[0]
  if (path === '/ws') clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req))
  else if (path === '/agent') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  else socket.destroy()
})
wss.on('connection', (ws) => {
  let machineId: string | null = null
  ws.on('message', (raw) => {
    let msg: AgentToCloud
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!machineId) {
      // 首帧：enroll（一次性 token）或 reenroll（长期 agentToken 重连）
      const conn = (mid: string) => ({ machineId: mid, send: (m: CloudToAgent) => ws.send(JSON.stringify(m)), close: () => ws.close() })
      if (msg.t === 'enroll') {
        const e = verifyEnrollToken(msg.token)
        if (!e) {
          ws.send(JSON.stringify({ error: '无效的 enroll token' }))
          ws.close()
          return
        }
        const mid = gateway.newMachineId()
        machineId = mid
        gateway.attach(conn(mid), msg.machine, e.orgId)
        const agentToken = signAgentToken(e.orgId, msg.machine.name)
        ws.send(JSON.stringify({ t: 'enrolled', machineId: mid, agentToken } satisfies CloudToAgent))
        console.log(`✓ agent enrolled: ${msg.machine.name} (${mid}) org=${e.orgId}`)
      } else if (msg.t === 'reenroll') {
        const p = verifyAgentToken(msg.agentToken)
        if (!p) {
          ws.send(JSON.stringify({ error: 'agentToken 无效或过期，请重新绑定' }))
          ws.close()
          return
        }
        const mid = gateway.newMachineId()
        machineId = mid
        gateway.attach(conn(mid), msg.machine, p.orgId)
        ws.send(JSON.stringify({ t: 'enrolled', machineId: mid, agentToken: msg.agentToken } satisfies CloudToAgent))
        console.log(`↻ agent reconnected: ${msg.machine.name} (${mid}) org=${p.orgId}`)
      } else {
        ws.close()
      }
      return
    }
    gateway.handle(machineId, msg)
  })
  const drop = () => {
    if (machineId) {
      gateway.detach(machineId)
      console.log(`✗ agent disconnected: ${machineId}`)
    }
  }
  ws.on('close', drop)
  ws.on('error', drop)
})
