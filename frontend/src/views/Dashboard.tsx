import { Boxes, CheckCircle2, KanbanSquare, TrendingUp, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar, PriorityBadge, StatusDot, cx } from '../lib/ui'
import type { View } from '../store/useStore'

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tint,
}: {
  icon: typeof Boxes
  label: string
  value: string | number
  hint: string
  tint: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg', tint)}>
          <Icon size={18} />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  )
}

export function Dashboard({ onNavigate }: { onNavigate: (v: View) => void }) {
  const allReqs = useStore((s) => s.requirements)
  const allTasks = useStore((s) => s.tasks)
  const allBots = useStore((s) => s.bots)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const bots = allBots.filter((b) => b.orgId === currentOrgId)
  const allProducts = useStore((s) => s.products)
  const currentProjectId = useStore((s) => s.currentProjectId)

  // 需求/任务按当前项目作用域；机器人（虚拟人力）账户级共享，不随项目切换
  const projectProductIds = new Set(
    allProducts.filter((p) => p.projectId === currentProjectId).map((p) => p.id),
  )
  const requirements = allReqs.filter((r) => r.productId && projectProductIds.has(r.productId))
  const tasks = allTasks.filter((t) => t.productId && projectProductIds.has(t.productId))

  const activeReq = requirements.filter((r) => r.status !== 'done').length
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length
  const done = tasks.filter((t) => t.status === 'done').length
  const working = bots.filter((b) => b.status === 'working').length
  const totalTasks = tasks.length || 1
  const completion = Math.round((done / totalTasks) * 100)

  const busy = bots.filter((b) => b.status === 'working')

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-slate-500">
          一个人，一支虚拟团队。今天有 {working} 个机器人在为你工作。
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={Boxes} label="进行中需求" value={activeReq} hint={`共 ${requirements.length} 个需求`} tint="bg-indigo-50 text-indigo-600" />
        <Stat icon={KanbanSquare} label="执行中任务" value={inProgress} hint={`共 ${tasks.length} 个任务`} tint="bg-sky-50 text-sky-600" />
        <Stat icon={Users} label="在岗机器人" value={working} hint={`团队规模 ${bots.length} 人`} tint="bg-violet-50 text-violet-600" />
        <Stat icon={CheckCircle2} label="整体完成率" value={`${completion}%`} hint={`${done} 个任务已交付`} tint="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 正在工作的机器人 */}
        <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <TrendingUp size={17} className="text-brand" /> 实时工位
            </h2>
            <button
              onClick={() => onNavigate('workforce')}
              className="text-xs font-medium text-brand hover:underline"
            >
              查看全部
            </button>
          </div>
          {busy.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">当前没有机器人在执行任务</p>
          ) : (
            <div className="space-y-3">
              {busy.map((b) => {
                const task = tasks.find((t) => t.id === b.currentTaskId)
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    <Avatar seed={b.avatarSeed} name={b.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{b.name}</span>
                        <span className="text-xs text-slate-400">{b.role}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {task ? task.title : '待命中'}
                      </div>
                    </div>
                    {task && (
                      <div className="w-28 shrink-0">
                        <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                          <span>进度</span>
                          <span>{task.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-brand transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 需求快照 */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">需求快照</h2>
            <button
              onClick={() => onNavigate('requirements')}
              className="text-xs font-medium text-brand hover:underline"
            >
              管理需求
            </button>
          </div>
          <div className="space-y-3">
            {requirements.slice(0, 4).map((r) => {
              const rt = tasks.filter((t) => t.requirementId === r.id)
              const rdone = rt.filter((t) => t.status === 'done').length
              return (
                <div key={r.id} className="rounded-xl border border-slate-100 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <PriorityBadge p={r.priority} />
                  </div>
                  <div className="text-xs text-slate-400">
                    {rt.length ? `${rdone}/${rt.length} 任务完成` : '待拆解任务'}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {/* 团队状态条 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 font-semibold">团队状态</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {bots.map((b) => (
            <div key={b.id} className="flex flex-col items-center gap-2 rounded-xl bg-slate-50 p-3 text-center">
              <Avatar seed={b.avatarSeed} name={b.name} size={40} />
              <div className="text-sm font-semibold">{b.name}</div>
              <StatusDot status={b.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
