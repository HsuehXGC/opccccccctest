// ── OPC Agent 协议 v0 ─────────────────────────────────────────
// 用户内网机器上跑一个常驻 agent，主动出站建立 WSS 长连接到云端网关。
// 之后所有指令都顺着这条已建立的连接回传（云端无法主动连入内网机器）。
//
// 传输：agent → 云端 单向发起，wss:443；只需出站，无需公网 IP / 开入站端口。
// 鉴权：一次性 enroll token（账户作用域、短时效）换取长期 agentToken（每机器）。

/** agent 上报的执行器：机器上一个 claude / codex 账户 */
export interface ExecutorInfo {
  id: string
  kind: 'claude' | 'codex'
  label: string
  status: 'idle' | 'busy' | 'offline'
}

export interface MachineInfo {
  name: string
  os: string
  hostname: string
}

// ── agent → 云端 ──────────────────────────────────────────
export type AgentToCloud =
  | { t: 'enroll'; token: string; machine: MachineInfo }
  | { t: 'heartbeat'; machineId: string; executors: ExecutorInfo[] }
  | { t: 'job:chunk'; jobId: string; stream: 'stdout' | 'stderr'; text: string }
  | { t: 'job:done'; jobId: string; exitCode: number; result: string }
  | { t: 'job:error'; jobId: string; error: string }

// ── 云端 → agent ──────────────────────────────────────────
export type CloudToAgent =
  | { t: 'enrolled'; machineId: string; agentToken: string }
  // 在指定执行器上跑一段任务简报（= claude -p / codex 的输入），流式回传
  // mode='plan' 时以 CLI plan 模式运行（只规划、不改动，用于会议讨论）
  | { t: 'job:dispatch'; jobId: string; executorId: string; kind: 'claude' | 'codex'; prompt: string; cwd?: string; mode?: 'plan' }
  | { t: 'job:cancel'; jobId: string }
  | { t: 'ping' }

// ── 云端向上游（SSE/前端）广播的执行流 ──────────────────────
export type JobEvent =
  | { type: 'chunk'; jobId: string; machineId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; jobId: string; machineId: string; result: string }
  | { type: 'error'; jobId: string; machineId: string; error: string }
