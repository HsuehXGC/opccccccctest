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
    const out = await gateway.runJob(executorId, prompt, cwd)
    res.json({ ok: true, ...out })
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
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
