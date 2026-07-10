import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, type AuthUser } from '../lib/authApi'
import { useStore } from './useStore'

// ── 鉴权状态（前端）───────────────────────────────────────
// token + 当前用户持久化到 localStorage；登录/注册成功后进入对应账户组工作区。
// 与工作区 store 解耦：只在登录/登出时调用 useStore.enterOrg 切换隔离作用域。

type Status = 'loading' | 'anon' | 'authed'

interface AuthState {
  token: string | null
  user: AuthUser | null
  status: Status
  orgUsers: AuthUser[]
  error: string | null
  busy: boolean

  login: (email: string, password: string) => Promise<boolean>
  register: (name: string, email: string, password: string) => Promise<boolean>
  logout: () => void
  loadMe: () => Promise<void>
  loadOrgUsers: () => Promise<void>
  createMember: (input: { name: string; email: string; password: string; memberRole: string }) => Promise<AuthUser | null>
  openRoot: (input: { name: string; email: string; password: string }) => Promise<AuthUser | null>
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
  setMemberDisabled: (id: string, disabled: boolean) => Promise<boolean>
  clearError: () => void
}

function enterWorkspace(orgId: string) {
  useStore.getState().enterOrg(orgId)
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      status: 'loading',
      orgUsers: [],
      error: null,
      busy: false,

      login: async (email, password) => {
        set({ busy: true, error: null })
        try {
          const { token, user } = await authApi.login({ email, password })
          enterWorkspace(user.orgId)
          set({ token, user, status: 'authed', busy: false })
          void get().loadOrgUsers()
          return true
        } catch (e) {
          set({ error: (e as Error).message, busy: false })
          return false
        }
      },

      register: async (name, email, password) => {
        set({ busy: true, error: null })
        try {
          const { token, user } = await authApi.register({ name, email, password })
          enterWorkspace(user.orgId)
          set({ token, user, status: 'authed', busy: false })
          void get().loadOrgUsers()
          return true
        } catch (e) {
          set({ error: (e as Error).message, busy: false })
          return false
        }
      },

      logout: () => {
        useStore.getState().enterOrg(null)
        set({ token: null, user: null, status: 'anon', orgUsers: [], error: null })
      },

      // 启动时用已存 token 校验身份；失败则登出
      loadMe: async () => {
        const token = get().token
        if (!token) {
          set({ status: 'anon' })
          return
        }
        try {
          const { user } = await authApi.me(token)
          enterWorkspace(user.orgId)
          set({ user, status: 'authed' })
          void get().loadOrgUsers()
        } catch {
          set({ token: null, user: null, status: 'anon' })
        }
      },

      loadOrgUsers: async () => {
        const token = get().token
        if (!token) return
        try {
          const { users } = await authApi.orgUsers(token)
          set({ orgUsers: users })
        } catch {
          /* 忽略 */
        }
      },

      createMember: async (input) => {
        const token = get().token
        if (!token) return null
        set({ error: null })
        try {
          const { user } = await authApi.createMember(token, input)
          set((s) => ({ orgUsers: [...s.orgUsers, user] }))
          return user
        } catch (e) {
          set({ error: (e as Error).message })
          return null
        }
      },

      openRoot: async (input) => {
        const token = get().token
        if (!token) return null
        set({ error: null })
        try {
          const { user } = await authApi.openRoot(token, input)
          return user
        } catch (e) {
          set({ error: (e as Error).message })
          return null
        }
      },

      changePassword: async (currentPassword, newPassword) => {
        const token = get().token
        if (!token) return false
        set({ error: null })
        try {
          await authApi.changePassword(token, { currentPassword, newPassword })
          return true
        } catch (e) {
          set({ error: (e as Error).message })
          return false
        }
      },

      setMemberDisabled: async (id, disabled) => {
        const token = get().token
        if (!token) return false
        set({ error: null })
        try {
          const { user } = await authApi.setMemberDisabled(token, id, disabled)
          set((s) => ({ orgUsers: s.orgUsers.map((u) => (u.id === user.id ? user : u)) }))
          return true
        } catch (e) {
          set({ error: (e as Error).message })
          return false
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'opc-auth',
      // 只持久化 token；user 启动时由 loadMe 重新校验拉取
      partialize: (s) => ({ token: s.token }),
    },
  ),
)
