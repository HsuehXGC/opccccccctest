import { gateway } from './agentGateway.ts'
import type { JobEvent } from './agentProtocol.ts'
import { q } from './db.ts'
import { claimable, markRunning, markDone, markError, updateProgress, recoverStuck, type Job } from './jobStore.ts'

// ── 云端常驻调度器 ─────────────────────────────────────────────
// 每隔一段时间捞出 queued job，为其账户组挑一个在线执行器，派单、落库产出。
// 与任何浏览器无关：关页面 / 刷新都不影响，后端照跑到底。

const TICK_MS = 2000
const MAX_PER_EXECUTOR = 3 // 单执行器并发上限（并行会议受益，任务够用）
const IDLE_MS = 180_000 // 单个 job 180s 无回传即判失败
const PERSIST_EVERY_MS = 2500 // 进度落库节流

const inflight = new Map<string, () => void>() // jobId(本地库) → 清理函数
const loadByExecutor = new Map<string, number>()

function inc(exec: string) { loadByExecutor.set(exec, (loadByExecutor.get(exec) ?? 0) + 1) }
function dec(exec: string) { loadByExecutor.set(exec, Math.max(0, (loadByExecutor.get(exec) ?? 0) - 1)) }

/** 为账户组挑一个有余量的在线执行器（负载最少优先） */
function pickExecutor(orgId: string): string | null {
  const execs = gateway
    .listMachines()
    .filter((m) => m.accountId === orgId && m.online)
    .flatMap((m) => m.executors)
    .map((e) => ({ id: e.id, load: loadByExecutor.get(e.id) ?? 0 }))
    .filter((e) => e.load < MAX_PER_EXECUTOR)
    .sort((a, b) => a.load - b.load)
  return execs[0]?.id ?? null
}

/** 任务 job 完成后：把产出写回 tasks，置为待复核，负责机器人置回 idle */
async function onTaskDone(job: Job, output: string): Promise<void> {
  if (job.ref_type !== 'task' || !job.ref_id) return
  await q(
    `UPDATE tasks SET output=$2, status='review', progress=100,
       log = (COALESCE(log,'[]'::jsonb) || $3::jsonb) WHERE id=$1`,
    [job.ref_id, output, JSON.stringify(['✓ 云端执行完成，待复核'])],
  )
  await q(`UPDATE bots SET status='idle', current_task_id=NULL, completed=completed+1
           WHERE id=(SELECT bot_id FROM tasks WHERE id=$1)`, [job.ref_id])
}

async function onTaskError(job: Job): Promise<void> {
  if (job.ref_type !== 'task' || !job.ref_id) return
  await q(`UPDATE tasks SET status='backlog',
             log = (COALESCE(log,'[]'::jsonb) || $2::jsonb) WHERE id=$1`,
    [job.ref_id, JSON.stringify(['✗ 云端执行失败，已退回待办'])])
  await q(`UPDATE bots SET status='idle', current_task_id=NULL
           WHERE id=(SELECT bot_id FROM tasks WHERE id=$1)`, [job.ref_id])
}

/** 启动一个 job：注册监听 → 派单 → 累积/落库 → 完成或失败 */
function startJob(job: Job, executorId: string): void {
  let remoteJobId = ''
  let acc = ''
  let chunks = 0
  let lastPersist = 0
  let idle: NodeJS.Timeout

  const armIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(async () => {
      cleanup()
      await markError(job.id, '执行器 180 秒无响应，已中断')
      await onTaskError(job)
    }, IDLE_MS)
  }
  const cleanup = () => {
    clearTimeout(idle)
    gateway.off('job', onJob)
    inflight.delete(job.id)
    dec(executorId)
  }
  const onJob = async (e: JobEvent) => {
    if (e.jobId !== remoteJobId) return
    armIdle()
    if (e.type === 'chunk') {
      acc += e.text
      chunks++
      if (Date.now() - lastPersist > PERSIST_EVERY_MS) {
        lastPersist = Date.now()
        updateProgress(job.id, acc, chunks).catch(() => {})
      }
    } else if (e.type === 'done') {
      cleanup()
      const out = e.result || acc
      await markDone(job.id, out, chunks)
      await onTaskDone(job, out)
    } else if (e.type === 'error') {
      cleanup()
      await markError(job.id, e.error)
      await onTaskError(job)
    }
  }

  inflight.set(job.id, cleanup)
  inc(executorId)
  gateway.on('job', onJob)
  try {
    remoteJobId = gateway.dispatch(executorId, job.prompt, undefined, job.mode === 'plan' ? 'plan' : undefined).jobId
    console.log(`▶ scheduler ${job.id} → ${executorId} (${job.kind}${job.ref_id ? ' ' + job.ref_id : ''})`)
  } catch (err) {
    cleanup()
    markError(job.id, (err as Error).message).then(() => onTaskError(job))
    return
  }
  armIdle()
}

async function tick(): Promise<void> {
  let jobs: Job[]
  try {
    jobs = await claimable()
  } catch {
    return // DB 未就绪时静默跳过
  }
  for (const job of jobs) {
    if (inflight.has(job.id)) continue
    const exec = pickExecutor(job.org_id)
    if (!exec) continue // 该账户组暂无空闲执行器，下一轮再试
    await markRunning(job.id, exec)
    startJob(job, exec)
  }
}

let timer: NodeJS.Timeout | null = null
export async function startScheduler(): Promise<void> {
  const n = await recoverStuck().catch(() => 0)
  if (n) console.log(`↻ 复位 ${n} 个中断的 running job 为 queued`)
  timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  console.log(`✓ 云端调度器已启动 · 每 ${TICK_MS}ms 一轮 · 单执行器并发 ${MAX_PER_EXECUTOR}`)
}
