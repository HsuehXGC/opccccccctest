import { useState } from 'react'
import { UserPlus, FolderPlus, Check, Crown, Laptop, Cpu, Sparkles, Plus, Copy, ShieldCheck, ShieldPlus, LogOut, AlertCircle, KeyRound, Ban, Power } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { Avatar, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { toast } from '../lib/toast'
import type { Executor } from '../types'

type OS = 'mac' | 'windows' | 'ubuntu'
const OS_META: Record<OS, { label: string; defaultName: string }> = {
  mac: { label: 'macOS', defaultName: 'My Mac' },
  ubuntu: { label: 'Ubuntu', defaultName: 'My Ubuntu' },
  windows: { label: 'Windows', defaultName: 'My PC' },
}
function installCmd(os: OS, token: string) {
  if (os === 'windows') return `$env:OPC_TOKEN="${token}"; irm https://get.opc.dev/install.ps1 | iex`
  return `curl -fsSL https://get.opc.dev/install.sh | OPC_TOKEN=${token} sh`
}
function genToken() {
  let s = 'enr_'
  for (let i = 0; i < 24; i++) s += 'abcdef0123456789'[Math.floor(Math.random() * 16)]
  return s
}

const EXEC_STATUS: Record<Executor['status'], { label: string; dot: string }> = {
  idle: { label: '空闲', dot: 'bg-emerald-500' },
  busy: { label: '忙碌', dot: 'bg-indigo-500' },
  offline: { label: '离线', dot: 'bg-slate-300' },
}

export function AccountView() {
  // 身份来自后端鉴权
  const authUser = useAuth((s) => s.user)!
  const orgUsers = useAuth((s) => s.orgUsers)
  const createMember = useAuth((s) => s.createMember)
  const openRoot = useAuth((s) => s.openRoot)
  const changePassword = useAuth((s) => s.changePassword)
  const setMemberDisabled = useAuth((s) => s.setMemberDisabled)
  const logout = useAuth((s) => s.logout)
  const authError = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)
  const isRoot = authUser.role === 'root'

  // 工作区（按 org 隔离）
  const currentOrgId = useStore((s) => s.currentOrgId)
  const accounts = useStore((s) => s.accounts)
  const projects = useStore((s) => s.projects).filter((p) => p.orgId === currentOrgId)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const switchProject = useStore((s) => s.switchProject)
  const addProject = useStore((s) => s.addProject)
  const products = useStore((s) => s.products)
  const machines = useStore((s) => s.machines).filter((m) => m.orgId === currentOrgId)
  const executors = useStore((s) => s.executors)
  const enrollMachine = useStore((s) => s.enrollMachine)

  const root = orgUsers.find((a) => a.role === 'root')
  const members = orgUsers.filter((a) => a.role === 'member')
  const ordered = root ? [root, ...members] : orgUsers

  const [addingMember, setAddingMember] = useState(false)
  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [mPassword, setMPassword] = useState('')
  const [mRole, setMRole] = useState('编辑')

  const [openingRoot, setOpeningRoot] = useState(false)
  const [rName, setRName] = useState('')
  const [rEmail, setREmail] = useState('')
  const [rPassword, setRPassword] = useState('')

  const [addingProject, setAddingProject] = useState(false)
  const [pName, setPName] = useState('')
  const [pDesc, setPDesc] = useState('')

  const [binding, setBinding] = useState(false)
  const [os, setOs] = useState<OS>('mac')
  const [token, setToken] = useState(genToken())
  const [copied, setCopied] = useState(false)

  const [changingPw, setChangingPw] = useState(false)
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">团队与账户</h1>
          <p className="mt-1 text-sm text-slate-500">
            一个 Root 账户 + 绑定的成员账户，共享下面的多个项目；虚拟人力在账户组内跨项目共享。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => {
              clearError()
              setCurPw('')
              setNewPw('')
              setChangingPw(true)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:border-brand/40 hover:text-brand"
          >
            <KeyRound size={15} /> 修改密码
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut size={15} /> 登出
          </button>
        </div>
      </header>

      {/* 账户组成员 */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">账户组成员 · {orgUsers.length}</h2>
          {isRoot && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  clearError()
                  setOpeningRoot(true)
                }}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
              >
                <ShieldPlus size={15} /> 开 Root 账号
              </button>
              <button
                onClick={() => {
                  clearError()
                  setAddingMember(true)
                }}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <UserPlus size={15} /> 绑定成员
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ordered.map((a) => {
            const isMe = a.id === authUser.id
            const canToggle = isRoot && a.role === 'member' && !isMe
            return (
              <div
                key={a.id}
                className={cx(
                  'flex items-center gap-3 rounded-2xl border bg-white p-4',
                  a.disabled ? 'border-slate-200 opacity-60' : isMe ? 'border-brand/40 ring-1 ring-brand/20' : 'border-slate-200',
                )}
              >
                <Avatar seed={a.avatarSeed} name={a.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{a.name}</span>
                    {a.role === 'root' ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        <Crown size={10} /> Root
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{a.memberRole}</span>
                    )}
                    {a.disabled && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">已停用</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">{a.email}</div>
                </div>
                {isMe ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-brand">
                    <Check size={14} /> 当前登录
                  </span>
                ) : canToggle ? (
                  <button
                    onClick={async () => {
                      const ok = await setMemberDisabled(a.id, !a.disabled)
                      if (ok) toast(a.disabled ? `已启用「${a.name}」` : `已停用「${a.name}」`)
                    }}
                    className={cx(
                      'flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition',
                      a.disabled
                        ? 'text-emerald-600 ring-emerald-200 hover:bg-emerald-50'
                        : 'text-slate-500 ring-slate-200 hover:bg-rose-50 hover:text-rose-600',
                    )}
                  >
                    {a.disabled ? <Power size={13} /> : <Ban size={13} />}
                    {a.disabled ? '启用' : '停用'}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* 项目 */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">共享项目 · {projects.length}</h2>
          <button
            onClick={() => setAddingProject(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <FolderPlus size={15} /> 新建项目
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
            这个账户组还没有项目，点「新建项目」开始你的工作区。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const count = products.filter((pr) => pr.projectId === p.id).length
              const active = p.id === currentProjectId
              return (
                <div key={p.id} className={cx('rounded-2xl border bg-white p-4', active ? 'border-brand/40 ring-1 ring-brand/20' : 'border-slate-200')}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {active && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">当前</span>}
                  </div>
                  <p className="mb-3 line-clamp-2 text-xs text-slate-500">{p.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{count} 个产品</span>
                    {!active && (
                      <button
                        onClick={() => switchProject(p.id)}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-brand/30 hover:bg-brand-soft"
                      >
                        切到此项目
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 本地算力 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">本地算力 · {machines.length}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <Sparkles size={10} /> agent 出站接入
            </span>
          </div>
          <button
            onClick={() => {
              setToken(genToken())
              setCopied(false)
              setBinding(true)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={15} /> 绑定电脑
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          账户绑定本地电脑，每台电脑跑一个个 claude / codex 执行器——就是「虚拟人力」背后真正干活的算力。
        </p>
        {machines.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
            还没有绑定电脑，点「绑定电脑」接入本地算力。
          </div>
        ) : (
          <div className="space-y-3">
            {machines.map((m) => {
              const owner = accounts.find((a) => a.id === m.accountId)?.name ?? authUser.name
              const execs = executors.filter((e) => e.machineId === m.id)
              return (
                <div key={m.id} className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Laptop size={17} />
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {m.name}
                        <span className={cx('h-1.5 w-1.5 rounded-full', m.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300')} />
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {m.os} · {owner}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {execs.map((e) => (
                      <span key={e.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs ring-1 ring-slate-100">
                        <Cpu size={12} className={e.kind === 'claude' ? 'text-indigo-500' : 'text-teal-500'} />
                        <span className="font-medium">{e.label}</span>
                        <span className={cx('h-1.5 w-1.5 rounded-full', EXEC_STATUS[e.status].dot)} />
                        <span className="text-slate-400">{EXEC_STATUS[e.status].label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 绑定成员 */}
      {addingMember && (
        <Modal open onClose={() => setAddingMember(false)} title="绑定成员账户">
          <Field label="姓名">
            <input className={inputCls} value={mName} onChange={(e) => setMName(e.target.value)} placeholder="成员姓名" autoFocus />
          </Field>
          <Field label="邮箱（登录用）">
            <input className={inputCls} value={mEmail} onChange={(e) => setMEmail(e.target.value)} placeholder="name@team.opc" />
          </Field>
          <Field label="初始密码（至少 6 位）">
            <input className={inputCls} type="text" value={mPassword} onChange={(e) => setMPassword(e.target.value)} placeholder="告知成员后可自行修改" />
          </Field>
          <Field label="角色">
            <div className="flex gap-2">
              {['编辑', '只读', '管理员'].map((r) => (
                <button
                  key={r}
                  onClick={() => setMRole(r)}
                  className={cx('flex-1 rounded-lg border py-2 text-sm font-medium transition', mRole === r ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>
          {authError && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
              <AlertCircle size={14} /> {authError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setAddingMember(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={async () => {
                if (!mName.trim() || mPassword.length < 6) return
                const u = await createMember({ name: mName.trim(), email: mEmail.trim() || `${mName.trim()}@team.opc`, password: mPassword, memberRole: mRole })
                if (u) {
                  toast(`已绑定成员「${u.name}」`)
                  setMName('')
                  setMEmail('')
                  setMPassword('')
                  setMRole('编辑')
                  setAddingMember(false)
                }
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              绑定
            </button>
          </div>
        </Modal>
      )}

      {/* 开 Root 账号 */}
      {openingRoot && (
        <Modal open onClose={() => setOpeningRoot(false)} title="给用户开 Root 账号">
          <p className="mb-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <ShieldPlus size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <span>为某个用户开通一个<span className="font-medium text-slate-700">独立账户组</span>，TA 作为该组的 Root，拥有自己隔离的工作区（项目/产品/文档/任务/虚拟人力）。</span>
          </p>
          <Field label="姓名">
            <input className={inputCls} value={rName} onChange={(e) => setRName(e.target.value)} placeholder="用户姓名" autoFocus />
          </Field>
          <Field label="邮箱（登录用）">
            <input className={inputCls} value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder="user@example.com" />
          </Field>
          <Field label="初始密码（至少 6 位）">
            <input className={inputCls} type="text" value={rPassword} onChange={(e) => setRPassword(e.target.value)} placeholder="告知用户后可自行修改" />
          </Field>
          {authError && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
              <AlertCircle size={14} /> {authError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setOpeningRoot(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={async () => {
                if (!rName.trim() || !rEmail.trim() || rPassword.length < 6) return
                const u = await openRoot({ name: rName.trim(), email: rEmail.trim(), password: rPassword })
                if (u) {
                  toast(`已为「${u.name}」开通 Root 账号（独立工作区）`)
                  setRName('')
                  setREmail('')
                  setRPassword('')
                  setOpeningRoot(false)
                }
              }}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              开通 Root
            </button>
          </div>
        </Modal>
      )}

      {/* 新建项目 */}
      {addingProject && (
        <Modal open onClose={() => setAddingProject(false)} title="新建项目">
          <Field label="项目名称">
            <input className={inputCls} value={pName} onChange={(e) => setPName(e.target.value)} placeholder="例如：新客户 · 电商小程序" autoFocus />
          </Field>
          <Field label="描述">
            <textarea className={inputCls} rows={2} value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="项目简述" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setAddingProject(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={() => {
                if (!pName.trim()) return
                addProject({ name: pName.trim(), description: pDesc.trim() })
                toast(`已创建项目「${pName.trim()}」`)
                setPName('')
                setPDesc('')
                setAddingProject(false)
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              创建并切换
            </button>
          </div>
        </Modal>
      )}

      {/* 绑定电脑 */}
      {binding && (
        <Modal open onClose={() => setBinding(false)} title="绑定本地电脑">
          <p className="mb-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            <span>
              在目标电脑上运行下面的命令。agent 会<span className="font-medium text-slate-700">出站</span>接入云端（只需 443），无需公网 IP、无需开入站端口。
            </span>
          </p>
          <div className="mb-3 flex gap-1.5">
            {(['mac', 'ubuntu', 'windows'] as OS[]).map((o) => (
              <button
                key={o}
                onClick={() => setOs(o)}
                className={cx('flex-1 rounded-lg border py-1.5 text-sm font-medium transition', os === o ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500 hover:border-slate-300')}
              >
                {OS_META[o].label}
              </button>
            ))}
          </div>
          <div className="mb-3 rounded-lg bg-slate-900 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">一行安装 · 含一次性 token</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(installCmd(os, token))
                  setCopied(true)
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
              >
                <Copy size={11} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <code className="block break-all font-mono text-[11px] leading-relaxed text-emerald-300">{installCmd(os, token)}</code>
          </div>
          <ol className="mb-4 space-y-1.5 text-xs text-slate-500">
            <li>1 · 运行命令，agent 以服务方式常驻（{os === 'mac' ? 'launchd' : os === 'windows' ? 'Windows 服务' : 'systemd'}）</li>
            <li>2 · agent 出站建立 WSS 长连接，注册到本账户</li>
            <li>3 · 自动探测机器上的 claude / codex 账户，登记为执行器</li>
          </ol>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-slate-100">
            <span>等待机器接入…（演示：模拟这台电脑已运行 agent）</span>
            <button
              onClick={() => {
                enrollMachine({ name: `${authUser.name} · ${OS_META[os].defaultName}`, os: OS_META[os].label })
                toast('已模拟接入一台电脑')
                setBinding(false)
              }}
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              模拟接入
            </button>
          </div>
        </Modal>
      )}

      {/* 修改密码 */}
      {changingPw && (
        <Modal open onClose={() => setChangingPw(false)} title="修改密码">
          <Field label="当前密码">
            <input className={inputCls} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoFocus />
          </Field>
          <Field label="新密码（至少 6 位）">
            <input className={inputCls} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          {authError && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
              <AlertCircle size={14} /> {authError}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setChangingPw(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              取消
            </button>
            <button
              onClick={async () => {
                if (!curPw || newPw.length < 6) return
                const ok = await changePassword(curPw, newPw)
                if (ok) {
                  toast('密码已修改')
                  setChangingPw(false)
                }
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
