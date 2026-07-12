// ── 鉴权 API 客户端 ───────────────────────────────────────
// 生产：同源相对路径 /api（navo7.com 由 nginx 把 /api 代理到后端），前后端同域。
// 开发：vite 跑在 5173，后端在 8787，直连 localhost:8787。
// 可用 VITE_API_URL 显式覆盖。

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

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8787/api' : '/api')

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

  // 云端数据 + 调度
  stateMeta: (token: string) => req<{ enabled: boolean; hasData: boolean }>('/state/meta', { token }),
  importSnapshot: (token: string, snapshot: unknown) => req<{ ok: true; counts: Record<string, number> }>('/import', { method: 'POST', body: { snapshot }, token }),
  getState: (token: string) => req<Record<string, unknown[]>>('/state', { token }),
  enqueueJobs: (token: string, jobs: unknown[]) => req<{ ok: true; jobs: { id: string; refId: string | null; status: string }[] }>('/jobs', { method: 'POST', body: { jobs }, token }),
  runMeeting: (token: string, meetingId: string, payload: unknown) => req<{ ok: true; running: boolean }>(`/meetings/${meetingId}/run`, { method: 'POST', body: payload, token }),
  getMeeting: (token: string, meetingId: string) => req<{ meeting: Record<string, unknown>; running: boolean }>(`/meetings/${meetingId}`, { token }),
  listJobs: (token: string, opts: { refId?: string; refType?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(opts as Record<string, string>).toString()
    return req<{ jobs: CloudJob[] }>(`/jobs${qs ? '?' + qs : ''}`, { token })
  },

  // 本地算力（真实 agent）
  machines: (token: string) => req<{ machines: LiveMachine[] }>('/machines', { token }),
  enrollToken: (token: string) => req<{ token: string; expiresInSec: number }>('/machines/enroll-token', { method: 'POST', token }),
  runExecutor: (token: string, body: { executorId: string; prompt: string }) =>
    req<{ ok: true; jobId: string; result: string }>('/agent/run', { method: 'POST', body, token }),
  removeMachine: (token: string, machineId: string) =>
    req<{ ok: true }>(`/machines/${machineId}`, { method: 'DELETE', token }),
}

type StreamEvent = { t: 'chunk'; text: string } | { t: 'done'; result: string } | { t: 'error'; error: string }

/** 流式派单：读 SSE 响应体，逐块回调（会话内容实时显示用） */
export async function runExecutorStream(
  token: string,
  body: { executorId: string; prompt: string; planMode?: boolean },
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/agent/run-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}))
    throw new Error((d as { error?: string }).error || `请求失败 (${res.status})`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as StreamEvent)
      } catch {
        /* 忽略半包/坏帧 */
      }
    }
  }
}

export interface CloudJob {
  id: string
  org_id: string
  kind: string
  ref_type: string | null
  ref_id: string | null
  title: string
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  output: string
  error: string | null
  chunks: number
  meta?: Record<string, unknown> | null
  created_at: number
}

export interface LiveExecutor {
  id: string
  kind: 'claude' | 'codex'
  label: string
  status: 'idle' | 'busy' | 'offline'
}
export interface LiveMachine {
  machineId: string
  machine: { name: string; os: string; hostname: string }
  accountId: string
  executors: LiveExecutor[]
  online: boolean
}
