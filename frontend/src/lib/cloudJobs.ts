import { useStore } from '../store/useStore'
import type { DocType } from '../types'
import type { CloudJob } from './authApi'

/** 解析 QA 判定：VERDICT: PASS / FAIL（拿不到判定返回 null → 交人工） */
export function parseQaVerdict(output: string): 'pass' | 'fail' | null {
  if (/VERDICT:\s*PASS/i.test(output)) return 'pass'
  if (/VERDICT:\s*FAIL/i.test(output)) return 'fail'
  return null
}

// QA 门禁 job 完成 → PASS 自动通过为完成；FAIL/不确定留在待复核交人工
function applyQaJobs(jobs: CloudJob[]): void {
  const st = useStore.getState()
  for (const j of jobs) {
    if (j.status !== 'done' || !j.ref_id) continue
    const taskId = j.ref_id.replace(/^qa:/, '')
    const t = st.tasks.find((x) => x.id === taskId)
    if (!t || t.status !== 'review') continue
    if (parseQaVerdict(j.output || '') === 'pass') st.moveTask(taskId, 'done')
    // FAIL / 不确定：留在待复核，交人工
  }
}

// 把云端 job 的结果回填到本地（任务 + 文档 + QA），关页面重开、执行中轮询都用它对账
export function applyJobs(jobs: CloudJob[]): void {
  applyJobsToTasks(jobs.filter((j) => j.ref_type === 'task'))
  applyDocJobs(jobs.filter((j) => j.ref_type === 'doc'))
  applyQaJobs(jobs.filter((j) => j.ref_type === 'qa'))
  // 记录仍在「排队中/运行中」的 refId，供 UI 排除、避免重复入队
  const active = jobs.filter((j) => (j.status === 'queued' || j.status === 'running') && j.ref_id).map((j) => j.ref_id as string)
  useStore.getState().setActiveJobRefs([...new Set(active)])
}

// 文档撰写 job 完成 → 若本地还没有该文档，据 job.meta + 产出建文档
function applyDocJobs(jobs: CloudJob[]): void {
  const st = useStore.getState()
  for (const j of jobs) {
    if (j.status !== 'done' || !j.ref_id) continue
    if (st.docs.some((d) => d.slug === j.ref_id)) continue
    const m = (j.meta ?? {}) as Record<string, unknown>
    if (!m.productId) continue
    st.addDoc({
      slug: j.ref_id,
      title: (m.title as string) || j.title || j.ref_id,
      type: ((m.type as DocType) || 'prd') as DocType,
      productId: m.productId as string,
      productVersion: (m.productVersion as string) || 'v1.0.0',
      requirementId: null,
      ownerBotId: (m.ownerBotId as string) ?? null,
      content: j.output || `# ${(m.title as string) || j.title}\n\n（未产出内容）`,
    })
  }
}

// 把云端 job 的结果回填到本地任务
export function applyJobsToTasks(jobs: CloudJob[]): void {
  const st = useStore.getState()
  // 同一任务可能有多个历史 job（重复入队/重试）。只按每个任务「最新」的一个 job 对账，
  // 否则多个输出不同的 done job 会轮流命中，把任务在 review/done 之间来回打，人工通过也会被打回。
  const latest = new Map<string, CloudJob>()
  for (const j of jobs) {
    if (j.ref_type !== 'task' || !j.ref_id) continue
    const prev = latest.get(j.ref_id)
    if (!prev || (j.created_at ?? 0) >= (prev.created_at ?? 0)) latest.set(j.ref_id, j)
  }
  for (const [refId, j] of latest) {
    const t = st.tasks.find((x) => x.id === refId)
    if (!t) continue
    if (j.status === 'done') {
      // 人工已通过（done）的任务视为终态，对账不再把它打回 review；仅在尚未回填过产出时回填一次。
      if (t.status !== 'done' && (t.output ?? '') !== (j.output ?? '')) {
        st.recordTaskRun(refId, { output: j.output, ok: true })
        st.moveTask(refId, 'review')
        if (t.botId) st.setBotStatus(t.botId, 'idle')
      }
    } else if (j.status === 'error' && t.status !== 'backlog' && t.status !== 'done') {
      st.moveTask(refId, 'backlog')
      if (t.botId) st.setBotStatus(t.botId, 'idle')
    } else if ((j.status === 'queued' || j.status === 'running') && t.status === 'backlog') {
      // 云端还在跑，本地反映为进行中
      st.moveTask(refId, 'in_progress')
    }
  }
}
