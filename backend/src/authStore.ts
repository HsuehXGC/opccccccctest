import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

// ── 用户持久化（JSON 文件）─────────────────────────────
// 账户体系：账户组（org）= 一个 Root 用户 + 若干成员用户。
// 每个 org 是一个隔离的工作区。用户存本地 JSON 文件（无需数据库依赖）。

export type Role = 'root' | 'member'

export interface StoredUser {
  id: string
  name: string
  email: string
  passwordHash: string
  orgId: string
  role: Role
  memberRole?: string // 成员的展示角色（编辑/只读/管理员）
  avatarSeed: string
  createdAt: number
  /** 停用后无法登录（软禁用） */
  disabled?: boolean
}

/** 对外安全用户（去除 passwordHash） */
export type SafeUser = Omit<StoredUser, 'passwordHash'>

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', '.data')
const DB_FILE = join(DATA_DIR, 'users.json')

let users: StoredUser[] = []

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(DB_FILE, JSON.stringify(users, null, 2))
}

let seq = 1
const genId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

export const toSafe = (u: StoredUser): SafeUser => {
  const { passwordHash: _drop, ...safe } = u
  return safe
}

// ── 初始化：读文件或写入种子 ────────────────────────────
function seed() {
  const now = Date.now()
  const mk = (name: string, email: string, pw: string, orgId: string, role: Role, memberRole?: string): StoredUser => ({
    id: genId(role === 'root' ? 'usr-root' : 'usr'),
    name,
    email: email.toLowerCase(),
    passwordHash: bcrypt.hashSync(pw, 10),
    orgId,
    role,
    memberRole,
    avatarSeed: name.slice(0, 1).toLowerCase() + orgId,
    createdAt: now,
  })
  // 种子账户组 org-1（与前端种子工作区/PlotMax 对应）
  users = [
    mk('陈学官', 'xueguanchen@gmail.com', 'plotmax2025', 'org-1', 'root'),
    mk('林工', 'lin@team.opc', 'member2025', 'org-1', 'member', '编辑'),
    mk('周运营', 'zhou@team.opc', 'member2025', 'org-1', 'member', '只读'),
  ]
  persist()
}

export function initStore() {
  if (existsSync(DB_FILE)) {
    try {
      users = JSON.parse(readFileSync(DB_FILE, 'utf8'))
      return
    } catch {
      // 文件损坏则重建
    }
  }
  seed()
}

// ── 查询 / 变更 ─────────────────────────────────────────
export const findByEmail = (email: string) => users.find((u) => u.email === email.toLowerCase())
export const findById = (id: string) => users.find((u) => u.id === id)
export const listByOrg = (orgId: string) => users.filter((u) => u.orgId === orgId)

export function insertUser(input: {
  name: string
  email: string
  password: string
  orgId: string
  role: Role
  memberRole?: string
}): StoredUser {
  const user: StoredUser = {
    id: genId(input.role === 'root' ? 'usr-root' : 'usr'),
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: bcrypt.hashSync(input.password, 10),
    orgId: input.orgId,
    role: input.role,
    memberRole: input.memberRole,
    avatarSeed: input.name.slice(0, 1).toLowerCase() + input.orgId + seq,
    createdAt: Date.now(),
  }
  users.push(user)
  persist()
  return user
}

export const verifyPassword = (user: StoredUser, password: string) => bcrypt.compareSync(password, user.passwordHash)

export function updatePassword(id: string, newPassword: string): boolean {
  const u = findById(id)
  if (!u) return false
  u.passwordHash = bcrypt.hashSync(newPassword, 10)
  persist()
  return true
}

export function setDisabled(id: string, disabled: boolean): boolean {
  const u = findById(id)
  if (!u) return false
  u.disabled = disabled
  persist()
  return true
}

export const newOrgId = () => `org-${Date.now().toString(36)}-${seq++}`
