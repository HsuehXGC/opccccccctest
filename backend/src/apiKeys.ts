import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

// ── 对外 API Key ──────────────────────────────────────────────
// 用户绑定本地算力后，可签发 API key，让第三方经标准接口调用其本地 claude。
// 明文只在创建时返回一次；库里只存 sha256 哈希。持久化到 .data/api-keys.json。
const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '.data', 'api-keys.json')

export interface ApiKeyRecord {
  id: string
  orgId: string
  name: string
  keyHash: string
  prefix: string // 展示用前缀，如 navo7-sk-1a2b3c…
  createdAt: number
  lastUsedAt: number | null
  revoked: boolean
  /** true=代理模式（可调用工具/执行命令）；false/缺省=受限模式（纯文本、禁工具，默认，给外部用更安全） */
  agent?: boolean
}
export interface PublicApiKey {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
  agent: boolean
}

let keys: ApiKeyRecord[] = []
try {
  if (existsSync(FILE)) keys = JSON.parse(readFileSync(FILE, 'utf8'))
} catch {
  /* 损坏则从空开始 */
}
function persist() {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(keys, null, 2))
  } catch {
    /* 落盘失败不致命 */
  }
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const toPublic = (k: ApiKeyRecord): PublicApiKey => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, agent: !!k.agent })

/** 新建一把 key；agent=true 为代理模式（可用工具），默认受限。返回明文 secret（仅此一次）+ 公开记录。 */
export function createApiKey(orgId: string, name: string, agent = false): { secret: string; record: PublicApiKey } {
  const secret = 'navo7-sk-' + randomBytes(24).toString('hex')
  const rec: ApiKeyRecord = {
    id: 'ak-' + randomBytes(6).toString('hex'),
    orgId,
    name: (name || '').trim() || '未命名 Key',
    keyHash: sha(secret),
    prefix: secret.slice(0, 16) + '…',
    createdAt: Date.now(),
    lastUsedAt: null,
    revoked: false,
    agent: !!agent,
  }
  keys.push(rec)
  persist()
  return { secret, record: toPublic(rec) }
}

export function listApiKeys(orgId: string): PublicApiKey[] {
  return keys.filter((k) => k.orgId === orgId && !k.revoked).sort((a, b) => b.createdAt - a.createdAt).map(toPublic)
}

export function revokeApiKey(orgId: string, id: string): boolean {
  const k = keys.find((k) => k.id === id && k.orgId === orgId && !k.revoked)
  if (!k) return false
  k.revoked = true
  persist()
  return true
}

/** 校验第三方带来的 key：返回其 org 记录（并刷新 lastUsedAt），无效返回 null。 */
export function resolveApiKey(raw: string | undefined | null): ApiKeyRecord | null {
  if (!raw) return null
  const h = sha(raw.trim())
  const k = keys.find((k) => k.keyHash === h && !k.revoked)
  if (!k) return null
  k.lastUsedAt = Date.now()
  persist()
  return k
}
