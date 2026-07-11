import { EventEmitter } from 'node:events'
import type { AgentToCloud, CloudToAgent, ExecutorInfo, JobEvent, MachineInfo } from './agentProtocol.ts'

// ── AgentGateway ──────────────────────────────────────────────
// 管理所有内网 agent 的常驻连接：注册、心跳、派单、回传中继。
// 传输无关——把一条已建立的连接（WebSocket / 其它）包成 AgentConnection 交进来即可。
// 里程碑 1：前台用 mock 驱动；本文件是真实 agent 接入的落点。

/** 一条已建立的 agent 连接（对上层屏蔽具体传输） */
export interface AgentConnection {
  machineId: string
  send: (msg: CloudToAgent) => void
  close: () => void
}

interface Enrollment {
  token: string
  accountId: string
  expiresAt: number
}

interface ConnectedAgent {
  conn: AgentConnection
  machine: MachineInfo
  accountId: string
  executors: ExecutorInfo[]
  lastSeen: number
}

let seq = 1
const genId = (p: string) => `${p}-${seq++}`

export class AgentGateway extends EventEmitter {
  private agents = new Map<string, ConnectedAgent>() // key: machineId
  private pending = new Map<string, Enrollment>() // key: enroll token

  // ── 注册 ────────────────────────────────────────────────
  /** 云端为某账户签发一次性、短时效的 enroll token（放进「绑定电脑」的安装命令里） */
  issueEnrollToken(accountId: string, ttlMs = 15 * 60_000): string {
    const token = genId('enr')
    this.pending.set(token, { token, accountId, expiresAt: Date.now() + ttlMs })
    return token
  }

  /** agent 用 enroll token 换取长期 agentToken + machineId */
  enroll(token: string, machine: MachineInfo): { machineId: string; agentToken: string; accountId: string } {
    const e = this.pending.get(token)
    if (!e) throw new Error('无效的 enroll token')
    if (Date.now() > e.expiresAt) {
      this.pending.delete(token)
      throw new Error('enroll token 已过期')
    }
    this.pending.delete(token)
    return { machineId: genId('m'), agentToken: genId('tok'), accountId: e.accountId }
  }

  // ── 连接生命周期 ────────────────────────────────────────
  attach(conn: AgentConnection, machine: MachineInfo, accountId: string) {
    this.agents.set(conn.machineId, { conn, machine, accountId, executors: [], lastSeen: Date.now() })
  }

  detach(machineId: string) {
    this.agents.delete(machineId)
  }

  /** 主动移除一台机器：关闭其连接（agent 随之退出）并从网关删除 */
  remove(machineId: string): boolean {
    const agent = this.agents.get(machineId)
    if (!agent) return false
    try {
      agent.conn.close()
    } catch {
      /* 忽略关闭异常 */
    }
    this.agents.delete(machineId)
    return true
  }

  /** 查某机器归属的账户组（用于越权校验） */
  orgOf(machineId: string): string | undefined {
    return this.agents.get(machineId)?.accountId
  }

  /** 处理 agent 上行消息 */
  handle(machineId: string, msg: AgentToCloud) {
    const agent = this.agents.get(machineId)
    if (!agent) return
    agent.lastSeen = Date.now()
    switch (msg.t) {
      case 'heartbeat':
        agent.executors = msg.executors
        break
      case 'job:chunk':
        this.emit('job', { type: 'chunk', jobId: msg.jobId, machineId, stream: msg.stream, text: msg.text } satisfies JobEvent)
        break
      case 'job:done':
        this.emit('job', { type: 'done', jobId: msg.jobId, machineId, result: msg.result } satisfies JobEvent)
        break
      case 'job:error':
        this.emit('job', { type: 'error', jobId: msg.jobId, machineId, error: msg.error } satisfies JobEvent)
        break
    }
  }

  // ── 派单 ────────────────────────────────────────────────
  /**
   * 把任务简报下发到承载指定执行器的机器 agent。
   * dispatch 是「派机器人执行任务」的落点：task.brief → 某执行器上的 claude -p。
   */
  dispatch(executorId: string, prompt: string, cwd?: string, mode?: 'plan'): { jobId: string; machineId: string } {
    const hit = this.findExecutor(executorId)
    if (!hit) throw new Error(`执行器 ${executorId} 不在线`)
    const { agent, executor } = hit
    const jobId = genId('job')
    agent.conn.send({ t: 'job:dispatch', jobId, executorId, kind: executor.kind, prompt, cwd, mode })
    return { jobId, machineId: agent.conn.machineId }
  }

  cancel(machineId: string, jobId: string) {
    this.agents.get(machineId)?.conn.send({ t: 'job:cancel', jobId })
  }

  /** 派单并等待完成（同步语义）：收集流式输出，job:done 时 resolve，error/超时 reject */
  runJob(executorId: string, prompt: string, cwd?: string, timeoutMs = 120_000): Promise<{ jobId: string; result: string }> {
    return new Promise((resolve, reject) => {
      let jobId = ''
      let out = ''
      const onJob = (e: JobEvent) => {
        if (e.jobId !== jobId) return
        if (e.type === 'chunk') out += e.text
        else if (e.type === 'done') {
          cleanup()
          resolve({ jobId, result: e.result || out })
        } else if (e.type === 'error') {
          cleanup()
          reject(new Error(e.error))
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('执行超时'))
      }, timeoutMs)
      const cleanup = () => {
        this.off('job', onJob)
        clearTimeout(timer)
      }
      try {
        jobId = this.dispatch(executorId, prompt, cwd).jobId
      } catch (err) {
        cleanup()
        reject(err as Error)
        return
      }
      this.on('job', onJob)
    })
  }

  // ── 查询 ────────────────────────────────────────────────
  listMachines() {
    return [...this.agents.values()].map((a) => ({
      machineId: a.conn.machineId,
      machine: a.machine,
      accountId: a.accountId,
      executors: a.executors,
      online: Date.now() - a.lastSeen < 60_000,
    }))
  }

  private findExecutor(executorId: string) {
    for (const agent of this.agents.values()) {
      const executor = agent.executors.find((e) => e.id === executorId)
      if (executor) return { agent, executor }
    }
    return null
  }
}

export const gateway = new AgentGateway()
