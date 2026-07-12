import { useEffect, useState } from 'react'
import { Rocket, Loader2, RefreshCw, Package, GitCommit, Play, AlertTriangle, Bot, CircleCheck, CircleDashed, Users, ListTodo } from 'lucide-react'
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
  const [reviewFb, setReviewFb] = useState('')
  const [it, setIt] = useState<Iteration | null>(null)
  const [running, setRunning] = useState(false)
  const hasWs = !!project?.workspace?.repoPath

  async function review(action: 'approve' | 'iterate', override?: { feedback?: string; goal?: string }) {
    if (!token || !currentProjectId) return
    try {
      await authApi.reviewAutopilot(token, currentProjectId, {
        action,
        feedback: override?.feedback ?? reviewFb.trim(),
        goal: override?.goal,
      })
      toast(action === 'approve' ? '已通过本轮发布' : '已启动下一轮自驾', 'success')
      setReviewFb('')
      setTimeout(load, 800)
    } catch (err) {
      toast('操作失败：' + (err as Error).message, 'warn')
    }
  }

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
      {it && (it.status === 'awaiting_review' || it.status === 'error') && (
        <div className={cx('mb-3 rounded-xl border p-3', it.status === 'error' ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60')}>
          {it.status === 'awaiting_review' ? (
            <>
              <div className="mb-1.5 text-sm font-semibold text-emerald-800">本轮已发布 {it.release_ver} · 待你 review</div>
              <p className="mb-2 text-[12px] text-emerald-700">看下方版本卡的改动与预览。可采纳评审会的下一轮建议，或通过收尾，或自己写反馈让 OPC 据此推进。</p>
              {it.review && (
                <div className="mb-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-indigo-800">
                    <Users size={13} /> 评审会{it.review.reviewers?.length ? ' · ' + it.review.reviewers.join('、') : ''}
                    <span className={cx('ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium', it.review.verdict === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                      {it.review.verdict === 'done' ? '团队建议收尾' : '团队建议下一轮'}
                    </span>
                  </div>
                  {it.review.summary && (
                    <p className="mb-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">{it.review.summary}</p>
                  )}
                  {it.review.verdict !== 'done' && (
                    <div className="rounded-md bg-white/70 p-2 text-[11px]">
                      <div className="font-medium text-indigo-900">下一轮目标：{it.review.goal}</div>
                      {it.review.feedback && <div className="mt-0.5 whitespace-pre-wrap text-slate-600">{it.review.feedback}</div>}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-1.5 text-sm font-semibold text-rose-800">本轮未产出可发布版本 · 需你决定</div>
              <p className="mb-2 text-[12px] text-rose-700">{it.error}</p>
            </>
          )}
          <textarea value={reviewFb} onChange={(e) => setReviewFb(e.target.value)} placeholder={it.status === 'error' ? '给点反馈/提示，让 OPC 换个思路重试…' : '评审反馈（可选）：哪里要改、下一轮往哪推进…'}
            className="mb-2 h-16 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand" />
          <div className="flex gap-2">
            {it.status === 'awaiting_review' ? (
              <>
                {it.review && it.review.verdict !== 'done' && (
                  <button onClick={() => review('iterate', { goal: it.review!.goal, feedback: it.review!.feedback })}
                    className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">采纳建议 → 下一轮</button>
                )}
                <button onClick={() => review('approve')} className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700">✅ 通过收尾</button>
                <button onClick={() => review('iterate')} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">按我的反馈跑</button>
              </>
            ) : (
              <>
                <button onClick={() => review('iterate')} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">据反馈重试</button>
                <button onClick={() => review('approve')} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50">关闭本轮</button>
              </>
            )}
          </div>
        </div>
      )}
      {!active && !['awaiting_review', 'error'].includes(it?.status ?? '') && (
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
      <BacklogPanel />
    </div>
  )
}

const cx = (...p: (string | false | undefined)[]) => p.filter(Boolean).join(' ')

// 待办 backlog 面板：显示驱动下一轮自驾的开放待办（评审会/项目会自动增减），支持手动增删。
function BacklogPanel() {
  const currentProjectId = useStore((s) => s.currentProjectId)
  // 注意：Zustand 选择器必须返回稳定引用；在选择器里 .filter() 会每次新建数组，
  // 触发 useSyncExternalStore 无限重渲染（React #185）。故选出原数组，在组件体里过滤。
  const allProducts = useStore((s) => s.products)
  const tasks = useStore((s) => s.tasks)
  const addTask = useStore((s) => s.addTask)
  const moveTask = useStore((s) => s.moveTask)
  const [title, setTitle] = useState('')
  const [prio, setPrio] = useState<'low' | 'medium' | 'high'>('medium')

  const products = allProducts.filter((p) => p.projectId === currentProjectId)
  const prodIds = new Set(products.map((p) => p.id))
  const firstProd = products[0]?.id ?? null
  const backlog = tasks.filter((t) => t.productId && prodIds.has(t.productId) && t.status === 'backlog')
  const dot = (p: string) => (p === 'high' || p === 'urgent' ? 'bg-rose-500' : p === 'low' ? 'bg-slate-300' : 'bg-amber-400')

  const add = () => {
    if (!title.trim() || !firstProd) return
    addTask({ title: title.trim(), description: '', priority: prio, requirementId: null, kind: 'work', productId: firstProd, brief: title.trim() })
    setTitle('')
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
        <ListTodo size={13} /> 待办 backlog · {backlog.length}
        <span className="ml-auto text-[10px] font-normal text-slate-400">自驾按此挑下一轮切片 · 评审会/项目会自动增减</span>
      </div>
      {backlog.length === 0 ? (
        <p className="mb-2 text-[11px] text-slate-400">暂无待办 — 自驾按 PRD/目标推进；开评审会或项目会后会自动补充。</p>
      ) : (
        <div className="mb-2 max-h-48 space-y-1 overflow-y-auto">
          {backlog.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 text-[12px]">
              <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', dot(t.priority))} />
              <span className="truncate text-slate-700">{t.title}</span>
              <button onClick={() => moveTask(t.id, 'done')} title="标记完成"
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 opacity-0 hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100">✓ 完成</button>
            </div>
          ))}
        </div>
      )}
      {firstProd && (
        <div className="flex gap-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="加一条待办（自驾下一轮可能挑到）…"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-brand" />
          <select value={prio} onChange={(e) => setPrio(e.target.value as 'low' | 'medium' | 'high')} className="rounded-lg border border-slate-200 px-1.5 text-[11px] outline-none">
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <button onClick={add} disabled={!title.trim()} className="rounded-lg bg-slate-700 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-40">添加</button>
        </div>
      )}
    </div>
  )
}

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
