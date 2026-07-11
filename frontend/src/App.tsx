import { useEffect, useState } from 'react'
import { ChevronDown, Command, FileText, KanbanSquare, LayoutDashboard, Loader2, LogOut, MessagesSquare, Pause, Play, Search, Target, Users } from 'lucide-react'
import { useStore, type View } from './store/useStore'
import { useAuth } from './store/useAuth'
import { Avatar, cx } from './lib/ui'
import { Toaster } from './lib/toast'
import { CommandPalette } from './components/CommandPalette'
import { bootstrapImport } from './lib/bootstrapImport'
import { Dashboard } from './views/Dashboard'
import { ProductWorkspace } from './views/ProductWorkspace'
import { Wiki } from './views/Wiki'
import { Kanban } from './views/Kanban'
import { Workforce } from './views/Workforce'
import { Meetings } from './views/Meetings'
import { AccountView } from './views/Account'
import { Login } from './views/Login'

const NAV: { key: View; label: string; icon: typeof Target }[] = [
  { key: 'dashboard', label: '概览', icon: LayoutDashboard },
  { key: 'requirements', label: '需求管理', icon: Target },
  { key: 'wiki', label: '产品文档', icon: FileText },
  { key: 'kanban', label: '任务看板', icon: KanbanSquare },
  { key: 'workforce', label: '虚拟人力', icon: Users },
  { key: 'meetings', label: '会议', icon: MessagesSquare },
]

export function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const tick = useStore((s) => s.tick)
  const simRunning = useStore((s) => s.simRunning)
  const toggleSim = useStore((s) => s.toggleSim)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const workingCount = useStore((s) => s.bots.filter((b) => b.status === 'working' && b.orgId === s.currentOrgId).length)

  const allProjects = useStore((s) => s.projects)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const switchProject = useStore((s) => s.switchProject)
  const projects = allProjects.filter((p) => p.orgId === currentOrgId)

  // 鉴权
  const authStatus = useAuth((s) => s.status)
  const authUser = useAuth((s) => s.user)
  const loadMe = useAuth((s) => s.loadMe)
  const logout = useAuth((s) => s.logout)

  const [paletteOpen, setPaletteOpen] = useState(false)

  // 启动时用已存 token 校验身份
  useEffect(() => {
    void loadMe()
  }, [loadMe])

  // 首次启动自动导入 PlotMax 2.0 演示数据（幂等，归属 org-1）
  useEffect(() => {
    void bootstrapImport()
  }, [])

  // 模拟机器人执行的心跳
  useEffect(() => {
    const id = setInterval(() => tick(), 1500)
    return () => clearInterval(id)
  }, [tick])

  // ⌘K / Ctrl+K 打开全局命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 鉴权门禁：未登录展示登录页
  if (authStatus === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-slate-300">
        <Loader2 size={28} className="animate-spin" />
      </div>
    )
  }
  if (authStatus === 'anon' || !authUser) {
    return (
      <>
        <Login />
        <Toaster />
      </>
    )
  }

  return (
    <>
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

        {/* 全局搜索入口 */}
        <div className="px-3 pb-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 transition hover:border-brand/40 hover:text-slate-600"
          >
            <Search size={15} />
            <span>搜索…</span>
            <kbd className="ml-auto flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium">
              <Command size={10} /> K
            </kbd>
          </button>
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
        <div className="m-3 mt-0 flex items-center gap-1">
          <button
            onClick={() => setView('account')}
            className={cx(
              'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border p-2.5 text-left transition',
              view === 'account' ? 'border-brand/30 bg-brand-soft' : 'border-slate-200 hover:bg-slate-50',
            )}
          >
            <Avatar seed={authUser.avatarSeed} name={authUser.name} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{authUser.name}</div>
              <div className="truncate text-[11px] text-slate-400">
                {authUser.role === 'root' ? 'Root 账户' : authUser.memberRole ?? '成员'}
              </div>
            </div>
          </button>
          <button
            onClick={logout}
            title="登出"
            className="shrink-0 self-stretch rounded-xl border border-slate-200 px-2 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 overflow-y-auto">
        {view === 'dashboard' && <Dashboard onNavigate={setView} />}
        {view === 'requirements' && <ProductWorkspace />}
        {view === 'wiki' && <Wiki />}
        {view === 'kanban' && <Kanban />}
        {view === 'workforce' && <Workforce />}
        {view === 'meetings' && <Meetings />}
        {view === 'account' && <AccountView />}
      </main>
    </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <Toaster />
    </>
  )
}
