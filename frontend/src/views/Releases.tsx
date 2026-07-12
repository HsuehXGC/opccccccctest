import { useEffect, useState } from 'react'
import { Rocket, Loader2, RefreshCw, Package, GitCommit, Play, AlertTriangle } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { authApi, type CloudJob } from '../lib/authApi'

// 解析发布 job 产出里的 ===MARKER=== 段
function parseRelease(output: string) {
  const sec = (name: string) => {
    const m = output.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?:\\n===|$)`))
    return (m?.[1] ?? '').trim()
  }
  return {
    version: sec('VERSION'),
    changelog: sec('CHANGELOG'),
    build: sec('BUILD'),
    artifact: sec('ARTIFACT'),
    run: sec('RUN'),
  }
}

export function Releases() {
  const token = useAuth((s) => s.token)
  const [jobs, setJobs] = useState<CloudJob[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!token) return
    authApi
      .listJobs(token, { refType: 'release' })
      .then((r) => setJobs(r.jobs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">发布 · 测试版本</h1>
          <p className="mt-1 text-sm text-slate-500">OPC 每轮集成后构建出的测试版本。你在这里 review 已发布版本，任务级不用管。</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50">
          <RefreshCw size={14} /> 刷新
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-300"><Loader2 size={22} className="animate-spin" /></div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Rocket size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">还没有发布。去「任务看板」点「发布测试版本」，OPC 会集成、构建并在这里列出。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((j) => {
            const r = parseRelease(j.output || '')
            const failed = j.status === 'error'
            const running = j.status === 'queued' || j.status === 'running'
            return (
              <div key={j.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                  <Package size={16} className="text-emerald-600" />
                  <span className="font-semibold">{r.version || j.title}</span>
                  {running && <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"><Loader2 size={10} className="animate-spin" /> 构建中</span>}
                  {j.status === 'done' && !failed && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">已发布</span>}
                  {failed && <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700"><AlertTriangle size={10} /> 发布失败</span>}
                </div>
                <div className="space-y-3 px-5 py-4 text-sm">
                  {r.changelog && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><GitCommit size={12} /> 本版改动 Changelog</div>
                      <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">{r.changelog}</pre>
                    </div>
                  )}
                  {r.artifact && (
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">产物</span>
                      <code className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">{r.artifact}</code>
                    </div>
                  )}
                  {r.run && (
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><Play size={12} /> 本地运行预览</div>
                      <code className="block break-all rounded-lg bg-slate-900 p-2.5 text-[12px] text-emerald-300">{r.run}</code>
                    </div>
                  )}
                  {failed && <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-[12px] text-rose-700">{(j.error || '').slice(-800)}</pre>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
