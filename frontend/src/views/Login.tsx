import { useState } from 'react'
import { LogIn, UserPlus, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { cx } from '../lib/ui'

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'

export function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const login = useAuth((s) => s.login)
  const register = useAuth((s) => s.register)
  const busy = useAuth((s) => s.busy)
  const error = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const isRegister = mode === 'register'

  async function submit() {
    if (isRegister) {
      if (!name.trim() || !email.trim() || password.length < 6) return
      await register(name.trim(), email.trim(), password)
    } else {
      if (!email.trim() || !password) return
      await login(email.trim(), password)
    }
  }

  function switchMode(m: 'login' | 'register') {
    setMode(m)
    clearError()
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-2.5">
          <img src="/logo.svg" alt="OPC" className="h-11 w-11" />
          <div className="text-center">
            <div className="text-lg font-bold leading-none">OPC · 虚拟人力中枢</div>
            <div className="mt-1.5 text-xs text-slate-400">让一个人管理多个 Claude CLI 机器人</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* 切换 */}
          <div className="mb-5 flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
            <button
              onClick={() => switchMode('login')}
              className={cx('flex-1 rounded-md py-1.5 transition', !isRegister ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}
            >
              登录
            </button>
            <button
              onClick={() => switchMode('register')}
              className={cx('flex-1 rounded-md py-1.5 transition', isRegister ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}
            >
              注册 Root 账号
            </button>
          </div>

          <div className="space-y-3" onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}>
            {isRegister && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">姓名</label>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" autoFocus />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">邮箱</label>
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoFocus={!isRegister}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">密码{isRegister && ' · 至少 6 位'}</label>
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
                <AlertCircle size={14} className="shrink-0" /> {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : isRegister ? (
                <UserPlus size={15} />
              ) : (
                <LogIn size={15} />
              )}
              {isRegister ? '创建 Root 账号并进入' : '登录'}
            </button>
          </div>

          {isRegister && (
            <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
              注册即开通一个独立账户组（工作区），你是它的 Root。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
