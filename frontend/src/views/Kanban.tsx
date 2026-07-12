import { useEffect, useMemo, useState } from 'react'
import { UserPlus, Terminal, FileText, Wrench, Lock, X, GitBranch, Plus, ExternalLink, ClipboardList, Rocket, Loader2, Cpu, Sparkles, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi, runExecutorStream, type LiveMachine } from '../lib/authApi'
import { assembleSystemPrompt } from '../lib/botCharter'
import { assignPrompt, parseAssignments, heuristicAssign } from '../lib/assign'
import { toast } from '../lib/toast'
import { Avatar, DOC_TYPE, PriorityBadge, TASK_COLUMNS, cx } from '../lib/ui'
import type { Task, TaskKind, TaskStatus } from '../types'

// ── 派单执行：任务 → 负责机器人(system prompt) + brief → 真实执行器 ──────────
function TaskDispatch({ task }: { task: Task }) {
  const bot = useStore((s) => s.bots.find((b) => b.id === task.botId))
  const recordTaskRun = useStore((s) => s.recordTaskRun)
  const token = useAuth((s) => s.token)

  const [machines, setMachines] = useState<LiveMachine[]>([])
  const [pickedExec, setPickedExec] = useState('')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'done' | 'error'>('idle')
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    if (!token) return
    let alive = true
    const load = () => authApi.machines(token).then((r) => alive && setMachines(r.machines)).catch(() => {})
    load()
    const id = setInterval(load, 6000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [token])

  const executors = machines
    .filter((m) => m.online)
    .flatMap((m) => m.executors.map((e) => ({ ...e, machineName: m.machine.name })))
  const effectiveExec = pickedExec || executors.find((e) => e.status === 'idle')?.id || executors[0]?.id || ''
  const fullPrompt = bot
    ? `${assembleSystemPrompt(bot)}\n\n---\n\n# 任务：${task.title}\n\n${task.brief || task.description || '（无简报）'}`
    : ''

  async function dispatch() {
    if (!bot || !effectiveExec || !token) return
    setRunning(true)
    setOutput('')
    setPhase('idle')
    let acc = ''
    try {
      await runExecutorStream(token, { executorId: effectiveExec, prompt: fullPrompt }, (e) => {
        if (e.t === 'chunk') {
          if (e.text.startsWith('[agent]')) return
          acc += e.text
          setOutput(acc)
        } else if (e.t === 'done') {
          const final = e.result || acc
          setOutput(final)
          setPhase('done')
          recordTaskRun(task.id, { output: final, ok: true })
          toast('派单执行完成，产出已回填交付物', 'success')
        } else if (e.t === 'error') {
          setOutput((acc + '\n' + e.error).trim())
          setPhase('error')
          recordTaskRun(task.id, { output: '', ok: false })
        }
      })
    } catch (e) {
      setOutput((o) => (o + '\n' + (e as Error).message).trim())
      setPhase('error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <Rocket size={12} /> 派单执行 · 真实算力
      </div>
      {!bot ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">先在下方「负责员工」指派一个机器人——将用它的岗位说明书作为 system prompt。</p>
      ) : executors.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
          没有在线的本地算力。去「团队与账户 → 本地算力」绑定一台电脑，并保持 agent 运行。
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Avatar seed={bot.avatarSeed} name={bot.name} size={20} />
            <span className="font-medium text-slate-700">{bot.name}</span>
            <span className="text-slate-400">{bot.role}</span>
            <button onClick={() => setShowPrompt((v) => !v)} className="ml-auto text-brand hover:underline">
              {showPrompt ? '收起' : '看最终 prompt'}
            </button>
          </div>
          {showPrompt && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-emerald-200">
              {fullPrompt}
            </pre>
          )}
          <div className="flex gap-1.5">
            <select
              value={effectiveExec}
              onChange={(e) => setPickedExec(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-brand"
            >
              {executors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.machineName} · {e.label}
                  {e.status === 'busy' ? '（忙）' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={dispatch}
              disabled={running || !effectiveExec}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
              {running ? '执行中…' : '派单执行'}
            </button>
          </div>
          {(running || output) && (
            <div
              className={cx(
                'max-h-64 overflow-auto whitespace-pre-wrap rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed',
                phase === 'error' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-slate-900 text-emerald-300',
              )}
            >
              <div className="mb-1 flex items-center gap-1 text-slate-400">
                <Cpu size={11} /> {bot.name} · claude 会话
                {running && <Loader2 size={10} className="animate-spin" />}
                {running && <span className="text-[10px]">实时回传中…</span>}
              </div>
              {output || (running ? '等待执行器输出…' : '(空)')}
              {running && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-400 align-middle" />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const KIND: Record<TaskKind, { label: string; icon: typeof FileText; cls: string }> = {
  doc: { label: '文档', icon: FileText, cls: 'bg-indigo-100 text-indigo-700' },
  work: { label: '执行', icon: Wrench, cls: 'bg-slate-100 text-slate-600' },
}

function useBlockers(task: Task) {
  const tasks = useStore((s) => s.tasks)
  return task.dependsOn
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t && t.status !== 'done')
}

// ── 分配菜单 ─────────────────────────────
function AssignMenu({ task, onClose }: { task: Task; onClose: () => void }) {
  const bots = useStore((s) => s.bots)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const assignTask = useStore((s) => s.assignTask)
  const available = bots.filter((b) => b.status !== 'offline' && b.orgId === currentOrgId)
  return (
    <div
      className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">分配给机器人</div>
      {available.map((b) => (
        <button
          key={b.id}
          onClick={() => {
            assignTask(task.id, b.id)
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
        >
          <Avatar seed={b.avatarSeed} name={b.name} size={24} />
          <span className="flex-1">{b.name}</span>
          <span className="text-[11px] text-slate-400">{b.role}</span>
        </button>
      ))}
    </div>
  )
}

// ── 任务卡 ───────────────────────────────
function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const bot = useStore((s) => s.bots.find((b) => b.id === task.botId))
  const targetDoc = useStore((s) => (task.targetDocSlug ? s.docs.find((d) => d.slug === task.targetDocSlug) : undefined))
  const blockers = useBlockers(task)
  const [menu, setMenu] = useState(false)
  const isRunning = task.status === 'in_progress' && bot?.status === 'working'
  const Kicon = KIND[task.kind].icon

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      onClick={onOpen}
      className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-brand/40 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium">
          <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5', KIND[task.kind].cls)}>
            <Kicon size={11} /> {KIND[task.kind].label}
          </span>
        </span>
        <PriorityBadge p={task.priority} />
      </div>
      <div className="mb-1.5 text-sm font-medium leading-snug">{task.title}</div>
      {task.description && <p className="mb-2.5 line-clamp-2 text-xs text-slate-500">{task.description}</p>}

      {/* 文档任务：目标文档 */}
      {targetDoc && (
        <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-100">
          <span className={cx('rounded px-1 text-[9px] font-semibold', DOC_TYPE[targetDoc.type].chip)}>
            {DOC_TYPE[targetDoc.type].abbr}
          </span>
          <span className="truncate">{targetDoc.title}</span>
        </div>
      )}

      {/* 被阻塞 */}
      {blockers.length > 0 && (
        <div className="mb-2.5 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
          <Lock size={11} /> 被 {blockers.length} 个任务阻塞
        </div>
      )}

      {/* 进度 */}
      {task.status !== 'backlog' && (
        <div className="mb-2.5">
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>{task.status === 'done' ? '已交付' : task.status === 'review' ? '待复核' : '执行中'}</span>
            <span>{task.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cx('h-full rounded-full transition-all', task.status === 'done' ? 'bg-emerald-500' : 'bg-brand')}
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 实时执行日志 */}
      {isRunning && task.log.length > 0 && (
        <div className="mb-2.5 rounded-lg bg-slate-900 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-emerald-300">
          <div className="mb-1 flex items-center gap-1 text-slate-400">
            <Terminal size={11} /> {bot?.name} · claude -p
          </div>
          {task.log.slice(-2).map((l, i) => (
            <div key={i} className="truncate">
              <span className="text-slate-500">$</span> {l}
            </div>
          ))}
        </div>
      )}

      {/* 机器人 */}
      <div className="relative flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
        {bot ? (
          <div className="flex items-center gap-1.5">
            <Avatar seed={bot.avatarSeed} name={bot.name} size={22} />
            <span className="text-xs font-medium text-slate-600">{bot.name}</span>
            <span className={cx('h-1.5 w-1.5 rounded-full', bot.status === 'working' ? 'bg-indigo-500 dot-pulse' : 'bg-slate-300')} />
          </div>
        ) : (
          <button
            onClick={() => setMenu(!menu)}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
          >
            <UserPlus size={13} /> 分配机器人
          </button>
        )}
        {menu && <AssignMenu task={task} onClose={() => setMenu(false)} />}
      </div>
    </div>
  )
}

function Column({
  status,
  label,
  accent,
  tasks,
  onOpen,
}: {
  status: TaskStatus
  label: string
  accent: string
  tasks: Task[]
  onOpen: (id: string) => void
}) {
  const moveTask = useStore((s) => s.moveTask)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/plain')
        if (id) moveTask(id, status)
      }}
      className={cx('flex w-full min-w-0 flex-col rounded-2xl bg-slate-100/70 p-3 transition', over && 'ring-2 ring-brand/40')}
    >
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className={cx('h-2.5 w-2.5 rounded-full', accent)} />
        <span className="text-sm font-semibold">{label}</span>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">{tasks.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">拖拽任务到此</div>
        )}
      </div>
    </div>
  )
}

// ── 任务详情抽屉 ─────────────────────────
function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId))
  const tasks = useStore((s) => s.tasks)
  const docs = useStore((s) => s.docs)
  const allBots = useStore((s) => s.bots)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const bots = allBots.filter((b) => b.orgId === currentOrgId)
  const requirements = useStore((s) => s.requirements)
  const updateTask = useStore((s) => s.updateTask)
  const moveTask = useStore((s) => s.moveTask)
  const assignTask = useStore((s) => s.assignTask)
  const unassignTask = useStore((s) => s.unassignTask)
  const addDependency = useStore((s) => s.addDependency)
  const removeDependency = useStore((s) => s.removeDependency)
  const openDoc = useStore((s) => s.openDoc)

  const [depSel, setDepSel] = useState('')

  if (!task) return null
  const bot = task.botId ? bots.find((b) => b.id === task.botId) : null
  const req = task.requirementId ? requirements.find((r) => r.id === task.requirementId) : null
  const targetDoc = task.targetDocSlug ? docs.find((d) => d.slug === task.targetDocSlug) : null
  const productDocs = docs.filter((d) => d.productId === task.productId)
  const blockers = task.dependsOn.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
  const blocking = blockers.filter((b) => b.status !== 'done')
  const depCandidates = tasks.filter((t) => t.id !== task.id && t.productId === task.productId && !task.dependsOn.includes(t.id))
  const Kicon = KIND[task.kind].icon

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-[480px] max-w-[92vw] flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', KIND[task.kind].cls)}>
                <Kicon size={11} /> {KIND[task.kind].label}任务
              </span>
              <PriorityBadge p={task.priority} />
            </div>
            <h3 className="text-base font-semibold leading-snug">{task.title}</h3>
            {req && <div className="mt-1 text-xs text-slate-400">来源需求：{req.title}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 状态流 */}
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">状态</div>
            <div className="flex gap-1">
              {TASK_COLUMNS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => moveTask(task.id, c.key)}
                  className={cx(
                    'flex-1 rounded-lg py-1.5 text-xs font-medium transition',
                    task.status === c.key ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {task.status === 'review' && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                复核交付物后，点「已完成」通过{task.kind === 'doc' ? '（将为目标文档生成新版本）' : ''}，或点「进行中」打回。
              </p>
            )}
          </div>

          {/* 执行简报 */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <ClipboardList size={12} /> 执行简报 · = claude -p 输入
            </div>
            <textarea
              value={task.brief}
              onChange={(e) => updateTask(task.id, { brief: e.target.value })}
              placeholder="给虚拟员工的执行指令 + 验收标准"
              className="h-32 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20"
            />
          </div>

          {/* 交付物 */}
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">交付物</div>
            {task.kind === 'doc' ? (
              <div className="space-y-2">
                <select
                  value={task.targetDocSlug ?? ''}
                  onChange={(e) => updateTask(task.id, { targetDocSlug: e.target.value || null })}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">选择目标文档…</option>
                  {productDocs.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.title}
                    </option>
                  ))}
                </select>
                {targetDoc && (
                  <button
                    onClick={() => openDoc(targetDoc.productId, targetDoc.slug)}
                    className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:border-brand hover:bg-brand-soft"
                  >
                    <span className={cx('rounded px-1 text-[10px] font-semibold', DOC_TYPE[targetDoc.type].chip)}>
                      {DOC_TYPE[targetDoc.type].abbr}
                    </span>
                    {targetDoc.title}
                    <span className="ml-auto text-[10px] text-slate-400">当前 {targetDoc.versions[0].version}</span>
                    <ExternalLink size={12} className="text-slate-400" />
                  </button>
                )}
              </div>
            ) : (
              <textarea
                value={task.output ?? ''}
                onChange={(e) => updateTask(task.id, { output: e.target.value })}
                placeholder="执行成果（完成后填写或由机器人产出）"
                className="h-24 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            )}
          </div>

          {/* 依赖 */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <GitBranch size={12} /> 依赖 · {task.dependsOn.length}
            </div>
            {blocking.length > 0 && (
              <div className="mb-2 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                <Lock size={11} /> 被 {blocking.length} 个未完成任务阻塞
              </div>
            )}
            <div className="space-y-1.5">
              {blockers.map((b) => (
                <div key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-sm">
                  <span
                    className={cx('h-2 w-2 shrink-0 rounded-full', b.status === 'done' ? 'bg-emerald-500' : 'bg-amber-400')}
                  />
                  <span className="flex-1 truncate">{b.title}</span>
                  <button onClick={() => removeDependency(task.id, b.id)} className="text-slate-300 hover:text-slate-500">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            {depCandidates.length > 0 && (
              <div className="mt-2 flex gap-1.5">
                <select
                  value={depSel}
                  onChange={(e) => setDepSel(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                >
                  <option value="">添加依赖（先完成谁）…</option>
                  {depCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (depSel) addDependency(task.id, depSel)
                    setDepSel('')
                  }}
                  className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                >
                  <Plus size={12} /> 加
                </button>
              </div>
            )}
          </div>

          {/* 负责员工 */}
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">负责员工</div>
            <select
              value={task.botId ?? ''}
              onChange={(e) => (e.target.value ? assignTask(task.id, e.target.value) : unassignTask(task.id))}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">未指派</option>
              {bots
                .filter((b) => b.status !== 'offline')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.role}
                  </option>
                ))}
            </select>
          </div>

          {/* 派单执行（真实算力）*/}
          <TaskDispatch task={task} />

          {/* 执行日志 */}
          {task.log.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Terminal size={12} /> 执行日志
              </div>
              <div className="rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-300">
                {task.log.map((l, i) => (
                  <div key={i}>
                    <span className="text-slate-500">$</span> {l}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {bot && (
          <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm">
            <Avatar seed={bot.avatarSeed} name={bot.name} size={26} />
            <span className="font-medium">{bot.name}</span>
            <span className="text-xs text-slate-400">{bot.model}</span>
            <span
              className={cx('ml-auto h-2 w-2 rounded-full', bot.status === 'working' ? 'bg-indigo-500 dot-pulse' : 'bg-slate-300')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── 批量执行：把「有负责人且未完成」的任务入队云端调度，后端常驻执行（关页面不中断）──
function BatchRun({ tasks }: { tasks: Task[] }) {
  const bots = useStore((s) => s.bots)
  const products = useStore((s) => s.products)
  const projects = useStore((s) => s.projects)
  const moveTask = useStore((s) => s.moveTask)
  const activeJobRefs = useStore((s) => s.activeJobRefs)
  const token = useAuth((s) => s.token)
  const [busy, setBusy] = useState(false)

  // 任务归属项目的真实工作区（有则走"代码任务"，在 repo 里改代码并提交）
  const workspaceOf = (t: Task) => {
    const product = products.find((p) => p.id === t.productId)
    const project = product && projects.find((p) => p.id === product.projectId)
    return { project, ws: project?.workspace }
  }

  const activeSet = new Set(activeJobRefs)
  // 已在云端排队/运行的任务（本视图内），按钮据此显示进度、并从可执行集排除
  const cloudRunning = tasks.filter((t) => activeSet.has(t.id)).length
  // 可执行 = 有负责人、未完成、无真实产出、且当前云端没有在跑（避免重复入队）
  const runnable = tasks.filter((t) => t.botId && t.status !== 'done' && !(t.output && t.output.trim()) && !activeSet.has(t.id))

  async function runAll() {
    if (busy || !token) return
    if (runnable.length === 0) {
      toast('没有可执行的任务（需已指派负责员工且未完成）', 'warn')
      return
    }
    setBusy(true)
    try {
      const jobs = runnable
        .map((t) => {
          const bot = bots.find((b) => b.id === t.botId)
          if (!bot) return null
          const { project, ws } = workspaceOf(t)
          if (ws?.repoPath) {
            // 代码任务：在真实 repo 里干活，切分支→改代码→提交（G0.2/G0.3/G0.4）
            const branch = `opc/${t.id}`
            const prompt = [
              assembleSystemPrompt(bot),
              '',
              '---',
              '',
              `你在项目「${project?.name ?? ''}」的真实代码仓库里工作，当前目录就是仓库根目录。`,
              '',
              `# 任务：${t.title}`,
              t.brief || t.description || '（无简报）',
              '',
              '## 执行要求',
              `1. 先切一个新分支：\`git checkout -b ${branch}\`（若已存在则 \`git checkout ${branch}\`）。`,
              '2. 读懂相关现有代码，做**小而完整、可编译**的改动，遵循现有代码风格。',
              '3. 只做本任务范围内的改动，不要顺手改别的。',
              `4. 提交时**只 \`git add\` 你本次真正改动/新建的具体文件（逐个写明路径）**，`,
              '   **绝对不要用 `git add -A` / `git add .`**——仓库里可能有大量未跟踪的构建产物/压缩包，不能提交它们。',
              `   然后 \`git commit -m "feat: ${t.title}"\`（一次清晰提交）。`,
              '5. 不要执行构建/测试（那是后续独立步骤）。最后简述你改了哪些文件、为什么。',
            ].join('\n')
            return { kind: 'task', refType: 'task', refId: t.id, title: t.title, prompt, cwd: ws.repoPath, targetMachine: ws.machine ?? null }
          }
          // 纯规划任务：出文本
          return {
            kind: 'task',
            refType: 'task',
            refId: t.id,
            title: t.title,
            prompt: `${assembleSystemPrompt(bot)}\n\n---\n\n# 任务：${t.title}\n\n${t.brief || t.description || '（无简报）'}`,
          }
        })
        .filter(Boolean)
      await authApi.enqueueJobs(token, jobs as unknown[])
      runnable.forEach((t) => moveTask(t.id, 'in_progress'))
      // 乐观标记为云端活跃：立刻让按钮变「云端执行中」，避免重复入队（下次轮询会对账）
      useStore.getState().setActiveJobRefs([...new Set([...activeJobRefs, ...runnable.map((t) => t.id)])])
      toast(`已入队 ${jobs.length} 个任务到云端调度，后端执行中——关页面/刷新都不影响，完成后自动进「待复核」`, 'success')
    } catch (err) {
      toast('入队失败：' + (err as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  // 无可执行、但云端有在跑 → 显示进度态（禁用，避免重复入队）
  if (cloudRunning > 0 && runnable.length === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-soft px-3.5 py-2 text-sm font-medium text-brand" title="任务在云端后台执行中，关页面/刷新都不影响">
        <Loader2 size={15} className="animate-spin" /> 云端执行中 ({cloudRunning})
      </span>
    )
  }

  return (
    <button
      onClick={runAll}
      disabled={busy || runnable.length === 0}
      title="把有负责人的未完成任务入队云端调度，由后端常驻执行；关页面/刷新都不中断"
      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
      {busy ? '入队中…' : `执行任务${runnable.length ? ` (${runnable.length})` : ''}${cloudRunning ? ` · 云端跑 ${cloudRunning}` : ''}`}
    </button>
  )
}

// ── 在工作区跑构建/测试（shell job，G2.1/G2.2）──
function ShellJobButton({ mode }: { mode: 'build' | 'test' }) {
  const currentProjectId = useStore((s) => s.currentProjectId)
  const project = useStore((s) => s.projects.find((p) => p.id === currentProjectId))
  const token = useAuth((s) => s.token)
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const ws = project?.workspace
  const cmd = mode === 'build' ? ws?.buildCmd : ws?.testCmd
  if (!ws?.repoPath || !cmd) return null
  const noun = mode === 'build' ? '构建' : '测试'

  async function run() {
    if (!token || !ws || status === 'running') return
    setStatus('running')
    const refId = `${mode}:${currentProjectId}`
    try {
      await authApi.enqueueJobs(token, [
        { kind: mode, refType: mode, refId, title: `${noun} ${project?.name ?? ''}`, prompt: `${ws.env ? ws.env + '\n' : ''}${cmd}`, cwd: ws.repoPath, targetMachine: ws.machine ?? null },
      ])
      toast(`${noun}已入队，在工作区执行中…`, 'success')
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const { jobs } = await authApi.listJobs(token, { refId })
        const j = jobs[0]
        if (!j) continue
        if (j.status === 'done') {
          setStatus('done')
          toast(`✅ ${noun}${mode === 'test' ? '通过' : '成功'}`, 'success')
          return
        }
        if (j.status === 'error') {
          setStatus('error')
          toast(`❌ ${noun}${mode === 'test' ? '未通过' : '失败'}：` + (j.error || '').slice(0, 140), 'warn')
          return
        }
      }
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      toast(`${noun}入队失败：` + (err as Error).message, 'warn')
    }
  }

  const doing = mode === 'build' ? '构建中…' : '测试中…'
  const ok = mode === 'build' ? '✅ 构建成功' : '✅ 测试通过'
  const bad = mode === 'build' ? '❌ 构建失败' : '❌ 测试未过'
  const idle = mode === 'build' ? '构建测试版本' : '跑测试'
  const label = status === 'running' ? doing : status === 'done' ? ok : status === 'error' ? bad : idle
  return (
    <button
      onClick={run}
      disabled={status === 'running'}
      title={`在工作区跑：${cmd}`}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
    >
      {status === 'running' ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} {label}
    </button>
  )
}

// ── 集成：把「完成」任务的 opc/<taskId> 分支合并成 opc/integration（shell job，G2.3）──
function IntegrateButton({ tasks }: { tasks: Task[] }) {
  const currentProjectId = useStore((s) => s.currentProjectId)
  const project = useStore((s) => s.projects.find((p) => p.id === currentProjectId))
  const token = useAuth((s) => s.token)
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const ws = project?.workspace
  // 本项目已完成、且是在真实 repo 里执行过的任务（产出里带 git 变更 → 有分支）
  const doneCode = tasks.filter((t) => t.status === 'done' && t.output && /GIT 变更|新提交/.test(t.output))
  if (!ws?.repoPath || doneCode.length === 0) return null

  async function run() {
    if (!token || !ws || status === 'running') return
    setStatus('running')
    const refId = `integrate:${currentProjectId}`
    const base = ws.branch || 'main'
    const branches = doneCode.map((t) => `opc/${t.id}`).join(' ')
    const script = [
      ws.env || '',
      `set +e`,
      `git checkout "${base}" || { echo "无法切到 ${base}（工作区可能有未提交改动）"; exit 1; }`,
      `git branch -D opc/integration 2>/dev/null`,
      `git checkout -b opc/integration || exit 1`,
      `MERGED=""; CONFLICTS=""`,
      `for b in ${branches}; do`,
      `  git rev-parse --verify "$b" >/dev/null 2>&1 || continue`,
      `  if git merge --no-edit "$b" >/dev/null 2>&1; then MERGED="$MERGED $b"; else git merge --abort; CONFLICTS="$CONFLICTS $b"; fi`,
      `done`,
      `echo "集成分支 opc/integration 就绪（base=${base}）"`,
      `echo "已合并:$MERGED"`,
      `[ -n "$CONFLICTS" ] && echo "⚠️ 冲突已跳过:$CONFLICTS" || echo "无冲突"`,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await authApi.enqueueJobs(token, [{ kind: 'integrate', refType: 'integrate', refId, title: `集成 ${project?.name ?? ''}`, prompt: script, cwd: ws.repoPath, targetMachine: ws.machine ?? null }])
      toast(`集成 ${doneCode.length} 个已完成任务的分支中…`, 'success')
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const { jobs } = await authApi.listJobs(token, { refId })
        const j = jobs[0]
        if (!j) continue
        if (j.status === 'done') {
          setStatus('done')
          const conflict = /冲突已跳过:\s*\S/.test(j.output)
          toast(conflict ? '⚠️ 集成完成，但有分支冲突（已跳过），需人工处理' : '✅ 集成成功，opc/integration 就绪', conflict ? 'warn' : 'success')
          return
        }
        if (j.status === 'error') {
          setStatus('error')
          toast('❌ 集成失败：' + (j.error || '').slice(0, 140), 'warn')
          return
        }
      }
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      toast('集成入队失败：' + (err as Error).message, 'warn')
    }
  }

  const label = status === 'running' ? '集成中…' : status === 'done' ? '✅ 已集成' : status === 'error' ? '❌ 集成失败' : `集成 (${doneCode.length})`
  return (
    <button
      onClick={run}
      disabled={status === 'running'}
      title="把已完成任务的 opc/<taskId> 分支合并成 opc/integration"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
    >
      {status === 'running' ? <Loader2 size={15} className="animate-spin" /> : <GitBranch size={15} />} {label}
    </button>
  )
}

// ── AI 复核（QA 门禁）：让 QA bot 判定待复核任务是否达标，PASS 自动通过 ──
function AiReview({ tasks }: { tasks: Task[] }) {
  const currentOrgId = useStore((s) => s.currentOrgId)
  const allBots = useStore((s) => s.bots)
  const token = useAuth((s) => s.token)
  const [busy, setBusy] = useState(false)

  const reviewable = tasks.filter((t) => t.status === 'review' && t.output && t.output.trim())
  if (reviewable.length === 0) return null
  const qaBot =
    allBots.find((b) => b.orgId === currentOrgId && b.role === '测试') ||
    allBots.find((b) => b.orgId === currentOrgId && b.role === '产品经理') ||
    allBots.find((b) => b.orgId === currentOrgId)

  async function run() {
    if (!token || busy || !qaBot) return
    setBusy(true)
    try {
      const jobs = reviewable.map((t) => ({
        kind: 'qa',
        refType: 'qa',
        refId: `qa:${t.id}`,
        title: `QA 复核：${t.title}`,
        prompt: [
          assembleSystemPrompt(qaBot),
          '',
          '---',
          '',
          '你是本次的质量把关人。判断下面这个已完成任务的**执行结果**是否真正满足**任务要求**。',
          '',
          `# 任务：${t.title}`,
          t.brief || t.description || '（无简报）',
          '',
          '# 执行结果（含代码改动摘要）',
          (t.output || '').slice(0, 6000),
          '',
          '# 你的判定',
          '第一行必须严格是：`VERDICT: PASS` 或 `VERDICT: FAIL`（二选一）。',
          '随后 1–2 句理由：满足在哪 / 不满足在哪、缺什么。宁严勿松——不确定就 FAIL。',
        ].join('\n'),
      }))
      await authApi.enqueueJobs(token, jobs)
      toast(`已派 QA 复核 ${jobs.length} 项，通过的会自动进「完成」，不过的留在待复核`, 'success')
    } catch (err) {
      toast('AI 复核入队失败：' + (err as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy || !qaBot}
      title="让 QA 机器人对照任务要求逐个判定；通过自动完成，不过留待人工"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3.5 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} AI 复核 ({reviewable.length})
    </button>
  )
}

// ── 复核通过：把「待复核且有真实产出」的任务批量通过为完成 ──
function ReviewApprove({ tasks }: { tasks: Task[] }) {
  const moveTask = useStore((s) => s.moveTask)
  const approvable = tasks.filter((t) => t.status === 'review' && t.output && t.output.trim())
  if (approvable.length === 0) return null
  return (
    <button
      onClick={() => {
        approvable.forEach((t) => moveTask(t.id, 'done'))
        toast(`已复核通过 ${approvable.length} 项，移入「完成」`, 'success')
      }}
      title="把已产出、待复核的任务批量通过为完成"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
    >
      <Check size={15} /> 复核通过 ({approvable.length})
    </button>
  )
}

// ── AI 自动分配负责人：为当前视图内「未指派」的任务按角色匹配虚拟员工 ──
function AiAssign({ tasks }: { tasks: Task[] }) {
  const currentOrgId = useStore((s) => s.currentOrgId)
  const allBots = useStore((s) => s.bots)
  const assignTask = useStore((s) => s.assignTask)
  const token = useAuth((s) => s.token)
  const [busy, setBusy] = useState(false)

  const bots = allBots.filter((b) => b.orgId === currentOrgId && b.status !== 'offline')
  const unassigned = tasks.filter((t) => !t.botId)

  async function pickExec(): Promise<string | null> {
    if (!token) return null
    try {
      const { machines } = await authApi.machines(token)
      const online = machines.filter((m) => m.online).flatMap((m) => m.executors)
      return online.find((e) => e.status === 'idle')?.id || online[0]?.id || null
    } catch {
      return null
    }
  }

  async function run() {
    if (busy) return
    if (unassigned.length === 0) {
      toast('当前没有未指派的任务', 'warn')
      return
    }
    if (bots.length === 0) {
      toast('没有可用的虚拟员工', 'warn')
      return
    }
    setBusy(true)
    try {
      let assignments: { taskId: string; botId: string }[] = []
      let aiUsed = false
      const exec = token ? await pickExec() : null
      if (exec && token) {
        const prompt = assignPrompt(unassigned, bots)
        let acc = ''
        try {
          await runExecutorStream(token, { executorId: exec, prompt, planMode: true }, (e) => {
            if (e.t === 'chunk') {
              if (!e.text.startsWith('[agent]')) acc += e.text
            } else if (e.t === 'done' && e.result) acc = e.result
          })
          assignments = parseAssignments(acc, unassigned, bots)
          aiUsed = assignments.length > 0
        } catch {
          /* 落到启发式 */
        }
      }
      // AI 未覆盖的任务用启发式兜底
      const covered = new Set(assignments.map((a) => a.taskId))
      const rest = unassigned.filter((t) => !covered.has(t.id))
      if (rest.length) assignments = assignments.concat(heuristicAssign(rest, bots))
      assignments.forEach((a) => assignTask(a.taskId, a.botId))
      toast(`已${aiUsed ? 'AI' : '启发式'}分配 ${assignments.length} 个任务的负责人`, 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy || unassigned.length === 0}
      title="为未指派的任务按角色/技能自动匹配负责员工（AI 优先，离线回退启发式）"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 bg-white px-3.5 py-2 text-sm font-medium text-brand transition hover:bg-brand-soft disabled:opacity-50"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
      {busy ? 'AI 分配中…' : `AI 分配${unassigned.length ? ` (${unassigned.length})` : ''}`}
    </button>
  )
}

export function Kanban() {
  const allProducts = useStore((s) => s.products)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const tasks = useStore((s) => s.tasks)
  const [productFilter, setProductFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  // 命令面板等跨模块跳转：自动打开目标任务抽屉
  const focusTaskId = useStore((s) => s.focusTaskId)
  const clearFocusTask = useStore((s) => s.clearFocusTask)
  useEffect(() => {
    if (focusTaskId) {
      setOpenId(focusTaskId)
      clearFocusTask()
    }
  }, [focusTaskId, clearFocusTask])


  const products = allProducts.filter((p) => p.projectId === currentProjectId)
  const projectProductIds = useMemo(() => new Set(products.map((p) => p.id)), [products])

  const filtered = useMemo(() => {
    // 先限定到当前项目，再按产品筛选
    const inProject = tasks.filter((t) => t.productId && projectProductIds.has(t.productId))
    const effective = productFilter !== 'all' && projectProductIds.has(productFilter) ? productFilter : 'all'
    return effective === 'all' ? inProject : inProject.filter((t) => t.productId === effective)
  }, [tasks, projectProductIds, productFilter])

  return (
    <div className="flex h-full flex-col px-8 py-7">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">任务看板</h1>
          <p className="mt-1 text-sm text-slate-500">拖拽流转状态；点卡片看详情、编简报、管依赖；给任务派机器人即可执行。</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="all">全部产品</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <AiAssign tasks={filtered} />
          <BatchRun tasks={filtered} />
          <AiReview tasks={filtered} />
          <ReviewApprove tasks={filtered} />
          <IntegrateButton tasks={filtered} />
          <ShellJobButton mode="build" />
          <ShellJobButton mode="test" />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map((c) => (
          <Column
            key={c.key}
            status={c.key}
            label={c.label}
            accent={c.accent}
            tasks={filtered.filter((t) => t.status === c.key)}
            onOpen={setOpenId}
          />
        ))}
      </div>

      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
