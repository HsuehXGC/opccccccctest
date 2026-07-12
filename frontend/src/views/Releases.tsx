import { useEffect, useState } from 'react'
import { Rocket, Loader2, RefreshCw, Package, GitCommit, Play, AlertTriangle, Bot, CircleCheck, CircleDashed } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useStore } from '../store/useStore'
import { authApi, type CloudJob, type Iteration } from '../lib/authApi'
import { toast } from '../lib/toast'

const PHASES: { key: string; label: string }[] = [
  { key: 'planning', label: '规划' },
  { key: 'executing', label: '执行' },
  { key: 'qa', label: 'QA复核' },
  { key: 'integrating', label: '集成' },
  { key: 'building', label: '构建' },
  { key: 'testing', label: '测试' },
  { key: 'releasing', label: '发布' },
  { key: 'awaiting_review', label: '待评审' },
]

// 自驾控制 + 当前迭代进度
function Autopilot() {
  const token = useAuth((s) => s.token)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const project = useStore((s) => s.projects.find((p) => p.id === currentProjectId))
  const [goal, setGoal] = useState('')
  const [feedback, setFeedback] = useState('')
  const [it, setIt] = useState<Iteration | null>(null)
  const [running, setRunning] = useState(false)
  const hasWs = !!project?.workspace?.repoPath

  const load = () => {
    if (!token || !currentProjectId) return
    authApi.getAutopilot(token, currentProjectId).then((r) => { setIt(r.iteration); setRunning(r.running) }).catch(() => {})
  }
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentProjectId])

  async function start() {
    if (!token || !currentProjectId || !goal.trim()) return
    try {
      await authApi.runAutopilot(token, { projectId: currentProjectId, goal: goal.trim(), feedback: feedback.trim() })
      toast('自驾已启动，OPC 开始规划本轮…', 'success')
      setGoal('')
      setTimeout(load, 800)
    } catch (err) {
      toast('启动失败：' + (err as Error).message, 'warn')
    }
  }

  if (!hasWs) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
        当前项目「{project?.name}」还没接工作区，无法自驾。去「团队与账户 → 项目 → 工作区」配置 repo 与构建命令。
      </div>
    )
  }

  const curIdx = it ? PHASES.findIndex((p) => p.key === it.status) : -1
  const active = running || (it && !['awaiting_review', 'done', 'error'].includes(it.status))

  return (
    <div className="mb-6 rounded-2xl border border-brand/30 bg-brand-soft/30 p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-brand"><Bot size={16} /> OPC 自驾 · {project?.name}</div>
      {!active && (
        <div className="space-y-2">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="本轮目标（如：给风险分析加一个 /health 健康检查端点）"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="上轮评审反馈（可选，会带进本轮规划）"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand" />
          <button onClick={start} disabled={!goal.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            <Rocket size={15} /> 自驾一轮
          </button>
          <p className="text-[11px] text-slate-400">OPC 会自己：规划任务 → 派人写代码 → QA 复核 → 集成 → 构建测试 → 发布测试版本。全程关页面也不中断，完成后在下方 review。</p>
        </div>
      )}
      {it && (
        <div className="mt-2">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">第 {it.round} 轮</span>
            <span className="truncate">· {it.goal}</span>
            {it.status === 'error' && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">出错</span>}
          </div>
          {/* 阶段进度条 */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {PHASES.map((p, i) => {
              const done = curIdx > i || it.status === 'awaiting_review' || it.status === 'done'
              const now = it.status === p.key && it.status !== 'awaiting_review'
              return (
                <span key={p.key} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                  now ? 'bg-brand text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}>
                  {now ? <Loader2 size={10} className="animate-spin" /> : done ? <CircleCheck size={10} /> : <CircleDashed size={10} />} {p.label}
                </span>
              )
            })}
          </div>
          {it.tasks.length > 0 && (
            <div className="mb-2 space-y-1">
              {it.tasks.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-medium',
                    t.status === 'passed' ? 'bg-emerald-100 text-emerald-700' : t.status === 'rejected' || t.status === 'exec_failed' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}>
                    {t.status === 'passed' ? '通过' : t.status === 'rejected' ? '驳回' : t.status === 'exec_failed' ? '失败' : t.status ?? '…'}
                  </span>
                  <span className="text-slate-600">{t.title}</span>
                  <span className="text-slate-400">· {t.role}</span>
                </div>
              ))}
            </div>
          )}
          {it.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{it.error}</p>}
          {it.phase_log.length > 0 && (
            <p className="text-[11px] text-slate-400">{it.phase_log[it.phase_log.length - 1]?.msg}</p>
          )}
        </div>
      )}
    </div>
  )
}

const cx = (...p: (string | false | undefined)[]) => p.filter(Boolean).join(' ')

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

      <Autopilot />

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
