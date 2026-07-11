import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { gateway } from './agentGateway.ts'
import type { AgentToCloud, CloudToAgent } from './agentProtocol.ts'
import { initStore } from './authStore.ts'
import {
  changePassword,
  createMember,
  login,
  openRoot,
  orgUsers,
  registerRoot,
  requireAuth,
  requireRoot,
  setMemberDisabled,
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

const app = express()
app.use(cors())
app.use(express.json())

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
// 「绑定电脑」：为当前账户组签发一次性 enroll token（放进安装命令）
app.post('/api/machines/enroll-token', requireAuth, (req: AuthedRequest, res) => {
  const token = gateway.issueEnrollToken(req.auth!.user.orgId)
  res.json({ token, expiresInSec: 900 })
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
      write({ t: 'done', result: e.result })
      finish()
    } else if (e.type === 'error') {
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

const PORT = Number(process.env.PORT) || 8787
const server = app.listen(PORT, () => {
  console.log(`✓ OPC backend (auth + agent gateway) on http://localhost:${PORT}`)
})

// ── /agent WebSocket：内网 agent 出站接入的落点 ───────────────
// agent 出站建 wss 长连接 → 首帧 enroll → attach → heartbeat / job 回传中继。
const wss = new WebSocketServer({ server, path: '/agent' })
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
      // 首帧必须是 enroll
      if (msg.t !== 'enroll') {
        ws.close()
        return
      }
      try {
        const { machineId: mid, agentToken, accountId } = gateway.enroll(msg.token, msg.machine)
        machineId = mid
        gateway.attach(
          { machineId: mid, send: (m: CloudToAgent) => ws.send(JSON.stringify(m)), close: () => ws.close() },
          msg.machine,
          accountId,
        )
        ws.send(JSON.stringify({ t: 'enrolled', machineId: mid, agentToken } satisfies CloudToAgent))
        console.log(`✓ agent enrolled: ${msg.machine.name} (${mid}) org=${accountId}`)
      } catch (err) {
        ws.send(JSON.stringify({ error: (err as Error).message }))
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
