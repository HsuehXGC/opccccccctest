import { useMemo, useState } from 'react'
import { UserPlus, Terminal, FileText, Wrench, Lock, X, GitBranch, Plus, ExternalLink, ClipboardList } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar, DOC_TYPE, PriorityBadge, TASK_COLUMNS, cx } from '../lib/ui'
import type { Task, TaskKind, TaskStatus } from '../types'

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
  const assignTask = useStore((s) => s.assignTask)
  const available = bots.filter((b) => b.status !== 'offline')
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
  const bots = useStore((s) => s.bots)
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

export function Kanban() {
  const allProducts = useStore((s) => s.products)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const tasks = useStore((s) => s.tasks)
  const [productFilter, setProductFilter] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

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
