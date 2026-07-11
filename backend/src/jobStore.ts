import { randomUUID } from 'node:crypto'
import { q, one } from './db.ts'

// ── jobs 持久化：云端调度的工作单元 ─────────────────────────────
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface Job {
  id: string
  org_id: string
  kind: string
  ref_type: string | null
  ref_id: string | null
  title: string
  executor_id: string | null
  prompt: string
  mode: string | null
  status: JobStatus
  output: string
  error: string | null
  chunks: number
  attempts: number
  created_at: number
  started_at: number | null
  finished_at: number | null
}

const now = () => Date.now()

export async function createJob(input: {
  orgId: string
  kind: string
  refType?: string | null
  refId?: string | null
  title?: string
  prompt: string
  mode?: string | null
}): Promise<Job> {
  const id = 'job_' + randomUUID().slice(0, 12)
  const rows = await q<Job>(
    `INSERT INTO jobs (id, org_id, kind, ref_type, ref_id, title, prompt, mode, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9) RETURNING *`,
    [id, input.orgId, input.kind, input.refType ?? null, input.refId ?? null, input.title ?? '', input.prompt, input.mode ?? null, now()],
  )
  return rows[0]
}

/** 取一批排队中的 job（调度器用），最早的优先 */
export const claimable = () => q<Job>(`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 50`)

export const getJob = (id: string) => one<Job>(`SELECT * FROM jobs WHERE id=$1`, [id])

export async function markRunning(id: string, executorId: string): Promise<void> {
  await q(`UPDATE jobs SET status='running', executor_id=$2, started_at=$3, attempts=attempts+1 WHERE id=$1`, [id, executorId, now()])
}

export async function updateProgress(id: string, output: string, chunks: number): Promise<void> {
  await q(`UPDATE jobs SET output=$2, chunks=$3 WHERE id=$1`, [id, output, chunks])
}

export async function markDone(id: string, output: string, chunks: number): Promise<void> {
  await q(`UPDATE jobs SET status='done', output=$2, chunks=$3, finished_at=$4 WHERE id=$1`, [id, output, chunks, now()])
}

export async function markError(id: string, error: string): Promise<void> {
  await q(`UPDATE jobs SET status='error', error=$2, finished_at=$3 WHERE id=$1`, [id, error, now()])
}

export async function requeue(id: string): Promise<void> {
  await q(`UPDATE jobs SET status='queued', executor_id=NULL, started_at=NULL WHERE id=$1`, [id])
}

/** 列出某账户组的 jobs（可按 ref/status 过滤），供前端轮询 */
export function listJobs(orgId: string, opts: { refId?: string; status?: string; limit?: number } = {}): Promise<Job[]> {
  const where = ['org_id=$1']
  const args: unknown[] = [orgId]
  if (opts.refId) { args.push(opts.refId); where.push(`ref_id=$${args.length}`) }
  if (opts.status) { args.push(opts.status); where.push(`status=$${args.length}`) }
  args.push(opts.limit ?? 200)
  return q<Job>(`SELECT * FROM jobs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${args.length}`, args)
}

/** 启动时把「运行中但没跑完」的 job 复位为排队（进程重启后自愈） */
export async function recoverStuck(): Promise<number> {
  const rows = await q<{ id: string }>(`UPDATE jobs SET status='queued', executor_id=NULL, started_at=NULL WHERE status='running' RETURNING id`)
  return rows.length
}
