# OPC · 接口文档

分两部分：**云端 REST / SSE 接口**（前端与运维用）与 **Agent 协议**（内网 agent 与云端网关之间）。

> 现状：后端为骨架（`backend/src/index.ts` + `agentGateway.ts`），实现了接口形态与网关逻辑；
> 真实 WebSocket agent 服务器在 M2 挂到 `/agent`。前端 M1 由内存 mock 驱动，尚未调用这些接口。

Base URL（开发）：`http://localhost:8787`

## 1. 云端 REST 接口

### GET `/api/health`
健康检查。
```json
200 → { "ok": true, "service": "opc-backend", "agents": 0 }
```

### POST `/api/machines/enroll-token`
为当前账户签发一次性、短时效的 enroll token（放进"绑定电脑"的安装命令）。
```jsonc
// 请求
{ "accountId": "acc-root" }
// 200
{ "token": "enr_xxx", "expiresInSec": 900 }
// 400 { "error": "accountId 必填" }
```

### POST `/api/agent/enroll`
agent 用 enroll token 换取长期凭证（真实实现里由 `/agent` WSS 首帧 `enroll` 触发；此为 HTTP 备用）。
```jsonc
// 请求
{ "token": "enr_xxx", "machine": { "name": "My Mac", "os": "macOS 15", "hostname": "mbp.local" } }
// 200
{ "machineId": "m-1", "agentToken": "tok_xxx", "accountId": "acc-root" }
// 400 { "error": "enroll token 已过期" }
```

### GET `/api/machines`
列出在线机器与其执行器。
```jsonc
200 → { "machines": [
  { "machineId": "m-1",
    "machine": { "name": "...", "os": "...", "hostname": "..." },
    "accountId": "acc-root",
    "executors": [ { "id": "e-1", "kind": "claude", "label": "claude · 主号", "status": "idle" } ],
    "online": true }
] }
```

### POST `/api/tasks/:taskId/dispatch`
派单：把任务简报下发到某执行器（= 某台电脑上的 `claude -p`）。
```jsonc
// 请求
{ "executorId": "e-1", "prompt": "<任务简报>" }
// 200
{ "dispatched": true, "jobId": "job-1", "machineId": "m-1" }
// 409 { "error": "执行器 e-1 不在线" }
```

### GET `/api/stream`（SSE）
把 agent 回传的执行事件推给前端。`Content-Type: text/event-stream`，每条：
```
data: {"type":"chunk","jobId":"job-1","machineId":"m-1","stream":"stdout","text":"..."}

data: {"type":"done","jobId":"job-1","machineId":"m-1","result":"..."}
```

## 2. Agent 协议（`backend/src/agentProtocol.ts`）

传输：agent → 云端 出站发起，`wss:443` 常驻连接。JSON 消息，`t` 为类型判别字段。

### 2.1 agent → 云端（AgentToCloud）

| `t` | 载荷 | 说明 |
| --- | --- | --- |
| `enroll` | `{ token, machine }` | 用 enroll token 注册 |
| `heartbeat` | `{ machineId, executors[] }` | 周期心跳 + 上报探测到的执行器 |
| `job:chunk` | `{ jobId, stream, text }` | 执行输出流式片段（stdout/stderr） |
| `job:done` | `{ jobId, exitCode, result }` | 任务完成 |
| `job:error` | `{ jobId, error }` | 任务失败 |

### 2.2 云端 → agent（CloudToAgent）

| `t` | 载荷 | 说明 |
| --- | --- | --- |
| `enrolled` | `{ machineId, agentToken }` | 注册回执，下发长期凭证 |
| `job:dispatch` | `{ jobId, executorId, kind, prompt, cwd? }` | 在指定执行器上跑简报 |
| `job:cancel` | `{ jobId }` | 取消任务 |
| `ping` | — | 保活 |

### 2.3 ExecutorInfo / MachineInfo
```ts
ExecutorInfo = { id, kind: 'claude'|'codex', label, status: 'idle'|'busy'|'offline' }
MachineInfo  = { name, os, hostname }
```

### 2.4 接入时序
```
agent                          云端网关
  │  (安装时拿到 enroll token)      │
  │──── enroll{token,machine} ────►│  校验 token（一次性、短时效）
  │◄─── enrolled{machineId,tok} ───│  签发长期 agentToken
  │──── heartbeat{executors} ─────►│  登记执行器、标记在线
  │                                │
  │◄─── job:dispatch{prompt} ──────│  派单（gateway.dispatch）
  │  本机跑 claude -p <prompt>      │
  │──── job:chunk … ──────────────►│  → SSE → 前端看板
  │──── job:done{result} ─────────►│  → 文档任务：目标文档生成新版本
```

## 3. 鉴权与安全约定

- **enroll token**：一次性、账户作用域、默认 15 分钟时效
- **agentToken**：每机器长期凭证，云端侧应存入 KMS，不明文长期落地
- **单向发起**：仅允许云端→机器派单，且限定可执行范围（非裸 shell）
- 撤销机器 = 作废其 agentToken 并断开连接

## 4. 前端状态接口（M1，将在 M2 被后端替换）

M1 前端所有数据在 `frontend/src/store/useStore.ts` 的 Zustand store 中，通过 actions 变更：
`addRequirement / addDoc / saveDocVersion / addTask / moveTask / dispatch(闭环) / enrollMachine …`。
M2 把其中执行相关的 action（派单、进度）改为调用上述 REST + 订阅 `/api/stream`。
