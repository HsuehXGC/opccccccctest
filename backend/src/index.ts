import express from 'express'
import { gateway } from './agentGateway.ts'

// ── OPC 后端骨架 ──────────────────────────────────────────────
// 架构：内网机器上的常驻 agent 出站建 WSS 长连接 → AgentGateway 管理连接、
//        注册、心跳、派单、回传中继。云端不主动连入内网机器。
//
// 里程碑 1：前台用 mock 驱动。
// 里程碑 2：接入真实 agent —— 在 /agent 挂 WebSocket 服务器，把每条连接包成
//           AgentConnection 交给 gateway；派单走 gateway.dispatch()。

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'opc-backend', agents: gateway.listMachines().length })
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
