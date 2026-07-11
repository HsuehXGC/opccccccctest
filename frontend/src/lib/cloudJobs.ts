import { useStore } from '../store/useStore'
import type { CloudJob } from './authApi'

// 把云端 job 的结果回填到本地任务（关页面后重开、或执行中轮询都用它对账）
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
