import { useEffect, useState } from 'react'
import { Cloud, CloudUpload, Loader2, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi } from '../lib/authApi'
import { toast } from '../lib/toast'

// 把当前浏览器 store 快照上传到云端 PG（一次性迁移 / 增量同步）
export function CloudSync() {
  const token = useAuth((s) => s.token)
  const [meta, setMeta] = useState<{ enabled: boolean; hasData: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    authApi.stateMeta(token).then(setMeta).catch(() => setMeta({ enabled: false, hasData: false }))
  }, [token])

  async function sync() {
    if (!token || busy) return
    setBusy(true)
    try {
      const s = useStore.getState()
      const snapshot = {
        projects: s.projects,
        products: s.products,
        requirements: s.requirements,
        docs: s.docs,
        tasks: s.tasks,
        bots: s.bots,
        meetings: s.meetings,
      }
      const { counts } = await authApi.importSnapshot(token, snapshot)
      toast(
        `已同步到云端：${counts.projects} 项目 · ${counts.products} 产品 · ${counts.tasks} 任务 · ${counts.docs} 文档 · ${counts.meetings} 会议`,
        'success',
      )
      setMeta({ enabled: true, hasData: true })
    } catch (err) {
      toast('同步失败：' + (err as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (meta && !meta.enabled) return null

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Cloud size={16} className="text-brand" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">云端数据</h2>
        {meta?.hasData && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            <Check size={11} /> 云端已有数据
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">
          把当前项目/产品/需求/文档/任务/会议上传到云端数据库。之后任务由后端常驻调度执行——
          <span className="font-medium text-slate-600">关页面、刷新、换设备都不中断</span>。建议每次改动后同步一次。
        </p>
        <button
          onClick={sync}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
          {busy ? '同步中…' : '同步到云端'}
        </button>
      </div>
    </section>
  )
}
