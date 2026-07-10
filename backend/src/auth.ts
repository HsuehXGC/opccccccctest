import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import {
  findByEmail,
  findById,
  insertUser,
  listByOrg,
  newOrgId,
  setDisabled,
  toSafe,
  updatePassword,
  verifyPassword,
  type Role,
  type SafeUser,
} from './authStore.ts'

// ── JWT ─────────────────────────────────────────────────
// 无状态 token：payload 带 userId / orgId / role，7 天有效。
// 生产应从环境变量注入 secret；此处开发默认值仅供演示。
const SECRET = process.env.OPC_JWT_SECRET || 'opc-dev-secret-change-me'
const TTL = '7d'

interface JwtPayload {
  sub: string
  orgId: string
  role: Role
}

export const signToken = (u: SafeUser) => jwt.sign({ sub: u.id, orgId: u.orgId, role: u.role } satisfies JwtPayload, SECRET, { expiresIn: TTL })

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, SECRET) as JwtPayload
  } catch {
    return null
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── 高层操作 ────────────────────────────────────────────
export function registerRoot(input: { name: string; email: string; password: string }): { token: string; user: SafeUser } {
  const name = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  const password = input.password ?? ''
  if (!name) throw new Error('姓名必填')
  if (!EMAIL_RE.test(email)) throw new Error('邮箱格式不正确')
  if (password.length < 6) throw new Error('密码至少 6 位')
  if (findByEmail(email)) throw new Error('该邮箱已注册')
  const user = insertUser({ name, email, password, orgId: newOrgId(), role: 'root' })
  const safe = toSafe(user)
  return { token: signToken(safe), user: safe }
}

export function login(input: { email: string; password: string }): { token: string; user: SafeUser } {
  const email = input.email?.trim().toLowerCase()
  const user = email ? findByEmail(email) : undefined
  if (!user || !verifyPassword(user, input.password ?? '')) throw new Error('邮箱或密码不正确')
  if (user.disabled) throw new Error('该账号已被停用')
  const safe = toSafe(user)
  return { token: signToken(safe), user: safe }
}

/** 修改自己的密码：先校验当前密码 */
export function changePassword(userId: string, currentPassword: string, newPassword: string): void {
  const user = findById(userId)
  if (!user) throw new Error('用户不存在')
  if (!verifyPassword(user, currentPassword ?? '')) throw new Error('当前密码不正确')
  if ((newPassword ?? '').length < 6) throw new Error('新密码至少 6 位')
  updatePassword(userId, newPassword)
}

/** root 停用/启用本账户组内的成员（不能停用 root 或自己） */
export function setMemberDisabled(actingRootId: string, orgId: string, memberId: string, disabled: boolean): SafeUser {
  const target = findById(memberId)
  if (!target || target.orgId !== orgId) throw new Error('成员不存在')
  if (target.role === 'root') throw new Error('不能停用 Root 账号')
  if (target.id === actingRootId) throw new Error('不能停用自己')
  setDisabled(memberId, disabled)
  return toSafe({ ...target, disabled })
}

/** root 在自己账户组内新增成员用户 */
export function createMember(orgId: string, input: { name: string; email: string; password: string; memberRole?: string }): SafeUser {
  const name = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  if (!name) throw new Error('姓名必填')
  if (!EMAIL_RE.test(email)) throw new Error('邮箱格式不正确')
  if ((input.password ?? '').length < 6) throw new Error('密码至少 6 位')
  if (findByEmail(email)) throw new Error('该邮箱已注册')
  return toSafe(insertUser({ name, email, password: input.password, orgId, role: 'member', memberRole: input.memberRole || '编辑' }))
}

/** 「给用户开 root 账号」：创建一个独立账户组 + 其 root 用户 */
export function openRoot(input: { name: string; email: string; password: string }): SafeUser {
  const { user } = registerRoot(input)
  return user
}

export const orgUsers = (orgId: string): SafeUser[] => listByOrg(orgId).map(toSafe)

// ── 中间件 ──────────────────────────────────────────────
export interface AuthedRequest extends Request {
  auth?: { user: SafeUser }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null
  const payload = token ? verifyToken(token) : null
  const user = payload ? findById(payload.sub) : null
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' })
  req.auth = { user: toSafe(user) }
  next()
}

export function requireRoot(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.user.role !== 'root') return res.status(403).json({ error: '需要 Root 权限' })
  next()
}
