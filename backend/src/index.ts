import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { gateway } from './agentGateway.ts'
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

// 「绑定电脑」：为当前账户签发一次性 enroll token（放进安装命令）
app.post('/api/machines/enroll-token', (req, res) => {
  const accountId = req.body?.accountId
  if (!accountId) return res.status(400).json({ error: 'accountId 必填' })
  const token = gateway.issueEnrollToken(accountId)
  res.json({ token, expiresInSec: 900 })
})

// agent 注册（真实实现里由 /agent WebSocket 首帧 enroll 触发；此处提供 HTTP 备用）
app.post('/api/agent/enroll', (req, res) => {
  const { token, machine } = req.body ?? {}
  if (!token || !machine) return res.status(400).json({ error: 'token 和 machine 必填' })
  try {
    res.json(gateway.enroll(token, machine))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// 在线机器与执行器
app.get('/api/machines', (_req, res) => {
  res.json({ machines: gateway.listMachines() })
})

// 派单：把任务简报下发到某执行器（= 某台电脑上的 claude -p）
app.post('/api/tasks/:taskId/dispatch', (req, res) => {
  const { executorId, prompt } = req.body ?? {}
  if (!executorId || !prompt) return res.status(400).json({ error: 'executorId 和 prompt 必填' })
  try {
    res.json({ dispatched: true, ...gateway.dispatch(executorId, prompt) })
  } catch (err) {
    res.status(409).json({ error: (err as Error).message })
  }
})

// 实时执行流（Server-Sent Events）——把 agent 回传的 job 事件推给前端
app.get('/api/stream', (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const onJob = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  gateway.on('job', onJob)
  res.on('close', () => gateway.off('job', onJob))
})

// TODO(M2): const wss = new WebSocketServer({ server, path: '/agent' })
//   wss.on('connection', ws => { /* enroll → gateway.attach → ws.on('message', m => gateway.handle(id, m)) */ })

const PORT = Number(process.env.PORT) || 8787
app.listen(PORT, () => {
  console.log(`✓ OPC backend (agent gateway) on http://localhost:${PORT}`)
})
