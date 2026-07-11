import { useStore } from '../store/useStore'
import type { DocType } from '../types'
import type { CloudJob } from './authApi'

// 把云端 job 的结果回填到本地（任务 + 文档），关页面重开、执行中轮询都用它对账
export function applyJobs(jobs: CloudJob[]): void {
  applyJobsToTasks(jobs.filter((j) => j.ref_type === 'task'))
  applyDocJobs(jobs.filter((j) => j.ref_type === 'doc'))
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
  for (const j of jobs) {
    if (j.ref_type !== 'task' || !j.ref_id) continue
    const t = st.tasks.find((x) => x.id === j.ref_id)
    if (!t) continue
    if (j.status === 'done' && (t.output ?? '') !== (j.output ?? '')) {
      st.recordTaskRun(j.ref_id, { output: j.output, ok: true })
      st.moveTask(j.ref_id, 'review')
      if (t.botId) st.setBotStatus(t.botId, 'idle')
    } else if (j.status === 'error' && t.status !== 'backlog' && t.status !== 'done') {
      st.moveTask(j.ref_id, 'backlog')
      if (t.botId) st.setBotStatus(t.botId, 'idle')
    } else if ((j.status === 'queued' || j.status === 'running') && t.status === 'backlog') {
      // 云端还在跑，本地反映为进行中
      st.moveTask(j.ref_id, 'in_progress')
    }
  }
}
