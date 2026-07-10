import { useEffect } from 'react'
import { ChevronDown, FileText, KanbanSquare, LayoutDashboard, Pause, Play, Target, Users } from 'lucide-react'
import { useStore, type View } from './store/useStore'
import { Avatar, cx } from './lib/ui'
import { Dashboard } from './views/Dashboard'
import { ProductWorkspace } from './views/ProductWorkspace'
import { Wiki } from './views/Wiki'
import { Kanban } from './views/Kanban'
import { Workforce } from './views/Workforce'
import { AccountView } from './views/Account'

const NAV: { key: View; label: string; icon: typeof Target }[] = [
  { key: 'dashboard', label: '概览', icon: LayoutDashboard },
  { key: 'requirements', label: '需求管理', icon: Target },
  { key: 'wiki', label: '产品文档', icon: FileText },
  { key: 'kanban', label: '任务看板', icon: KanbanSquare },
  { key: 'workforce', label: '虚拟人力', icon: Users },
]

export function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const tick = useStore((s) => s.tick)
  const simRunning = useStore((s) => s.simRunning)
  const toggleSim = useStore((s) => s.toggleSim)
  const workingCount = useStore((s) => s.bots.filter((b) => b.status === 'working').length)

  const projects = useStore((s) => s.projects)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const switchProject = useStore((s) => s.switchProject)
  const accounts = useStore((s) => s.accounts)
  const currentAccountId = useStore((s) => s.currentAccountId)
  const account = accounts.find((a) => a.id === currentAccountId) ?? accounts[0]

  // 模拟机器人执行的心跳
  useEffect(() => {
    const id = setInterval(() => tick(), 1500)
    return () => clearInterval(id)
  }, [tick])

  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/logo.svg" alt="OPC" className="h-8 w-8" />
          <div>
            <div className="text-[15px] font-bold leading-none">OPC</div>
            <div className="mt-1 text-[11px] text-slate-400">虚拟人力中枢</div>
          </div>
        </div>

        {/* 项目切换 */}
        <div className="px-3 pb-2">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">当前项目</div>
          <div className="relative">
            <select
              value={currentProjectId}
              onChange={(e) => switchProject(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 pr-8 text-sm font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-2.5 text-slate-400" />
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                view === key ? 'bg-brand-soft text-brand' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
              )}
            >
              <Icon size={18} strokeWidth={2.1} />
              {label}
            </button>
          ))}
        </nav>

        {/* 引擎状态 */}
        <div className="mx-3 mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">执行引擎</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={cx('h-1.5 w-1.5 rounded-full', simRunning ? 'bg-emerald-500 dot-pulse' : 'bg-slate-300')} />
              {simRunning ? '运行中' : '已暂停'}
            </span>
          </div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-slate-400">{workingCount} 个机器人正在执行任务</p>
          <button
            onClick={() => toggleSim(!simRunning)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {simRunning ? <Pause size={13} /> : <Play size={13} />}
            {simRunning ? '暂停引擎' : '启动引擎'}
          </button>
        </div>

        {/* 账户 */}
        <button
          onClick={() => setView('account')}
          className={cx(
            'm-3 mt-0 flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition',
            view === 'account' ? 'border-brand/30 bg-brand-soft' : 'border-slate-200 hover:bg-slate-50',
          )}
        >
          <Avatar seed={account.avatarSeed} name={account.name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{account.name}</div>
            <div className="truncate text-[11px] text-slate-400">
              {account.kind === 'root' ? 'Root 账户' : account.memberRole ?? '成员'}
            </div>
          </div>
        </button>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 overflow-y-auto">
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'requirements' && <ProductWorkspace />}
        {view === 'wiki' && <Wiki />}
        {view === 'kanban' && <Kanban />}
        {view === 'workforce' && <Workforce />}
        {view === 'account' && <AccountView />}
      </main>
    </div>
  )
}
