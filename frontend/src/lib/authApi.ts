// ── 鉴权 API 客户端 ───────────────────────────────────────
// 前端跑在 5173，后端 auth 在 8787。可用 VITE_API_URL 覆盖。

export interface AuthUser {
  id: string
  name: string
  email: string
  orgId: string
  role: 'root' | 'member'
  memberRole?: string
  avatarSeed: string
  createdAt: number
  disabled?: boolean
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787/api'

async function req<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`)
  return data as T
}

export const authApi = {
  register: (body: { name: string; email: string; password: string }) =>
    req<{ token: string; user: AuthUser }>('/auth/register', { method: 'POST', body }),
  login: (body: { email: string; password: string }) =>
    req<{ token: string; user: AuthUser }>('/auth/login', { method: 'POST', body }),
  me: (token: string) => req<{ user: AuthUser }>('/auth/me', { token }),
  orgUsers: (token: string) => req<{ users: AuthUser[] }>('/org/users', { token }),
  createMember: (token: string, body: { name: string; email: string; password: string; memberRole: string }) =>
    req<{ user: AuthUser }>('/org/members', { method: 'POST', body, token }),
  openRoot: (token: string, body: { name: string; email: string; password: string }) =>
    req<{ user: AuthUser }>('/admin/roots', { method: 'POST', body, token }),
  changePassword: (token: string, body: { currentPassword: string; newPassword: string }) =>
    req<{ ok: true }>('/auth/password', { method: 'POST', body, token }),
  setMemberDisabled: (token: string, id: string, disabled: boolean) =>
    req<{ user: AuthUser }>(`/org/members/${id}/disabled`, { method: 'POST', body: { disabled }, token }),
}
