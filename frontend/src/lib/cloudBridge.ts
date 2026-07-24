import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi } from './authApi'

// ── 云端桥接：PG 为真相 ──────────────────────────────────────
// 登录后：云端有数据 → 拉下来覆盖本地（多设备一致）；云端空、本地有 → 首次推上去。
// 之后：本地领域数据任何改动 → 防抖整快照回写 PG（write-through）。

type Slice = 'projects' | 'products' | 'requirements' | 'docs' | 'tasks' | 'bots' | 'meetings'
const SLICES: Slice[] = ['projects', 'products', 'requirements', 'docs', 'tasks', 'bots', 'meetings']

function snapshot(): Record<Slice, unknown[]> {
  const s = useStore.getState() as any
  return Object.fromEntries(SLICES.map((k) => [k, s[k]])) as Record<Slice, unknown[]>
}

// 第三层根治：增量同步。prevRows = 已知服务端状态（每行内容，不含 updatedAt）。
// 每次只推「变化/新增的行」+「删除的 id」，从不推全量 → 旧全量盖不掉一切；删除也真正生效。
const rowKey = (r: any) => r?.id ?? r?.slug ?? ''
const contentOf = (r: any) => { const { updatedAt: _u, ...rest } = r ?? {}; return JSON.stringify(rest) }
const prevRows: Record<Slice, Map<string, string>> = Object.fromEntries(SLICES.map((k) => [k, new Map()])) as any

function seedPrev(): void {
  const s = useStore.getState() as any
  for (const k of SLICES) {
    const m = prevRows[k]
    m.clear()
    for (const r of s[k] as any[]) m.set(rowKey(r), contentOf(r))
  }
}

interface Delta { upserts: Record<string, unknown[]>; deletes: Record<string, string[]>; changed: boolean }
function computeDelta(): Delta {
  const now = Date.now()
  const s = useStore.getState() as any
  const upserts: Record<string, unknown[]> = {}
  const deletes: Record<string, string[]> = {}
  let changed = false
  for (const k of SLICES) {
    const cur = s[k] as any[]
    const prev = prevRows[k]
    const seen = new Set<string>()
    const up: unknown[] = []
    for (const row of cur) {
      const id = rowKey(row)
      seen.add(id)
      const content = contentOf(row)
      if (prev.get(id) !== content) up.push({ ...row, updatedAt: now }) // 变化/新增 → 盖新时间戳
    }
    const del = [...prev.keys()].filter((id) => !seen.has(id)) // 本地已删
    if (up.length) { upserts[k] = up; changed = true }
    if (del.length) { deletes[k] = del; changed = true }
  }
  return { upserts, deletes, changed }
}
// 推送成功后把 delta 落到 prevRows（认为服务端已是这个状态）
function commitDelta(): void {
  const s = useStore.getState() as any
  for (const k of SLICES) {
    const m = prevRows[k]
    const ids = new Set<string>()
    for (const r of s[k] as any[]) { const id = rowKey(r); ids.add(id); m.set(id, contentOf(r)) }
    for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id)
  }
}

let suppress = false // 抑制 hydrate 自身触发的回写
let syncing = false
let debounce: ReturnType<typeof setTimeout> | null = null
let subscribed = false

/** 登录后调用一次：决定拉云端还是首次推上去 */
export async function bootstrapCloud(token: string): Promise<'pulled' | 'pushed' | 'skip'> {
  let meta: { enabled: boolean; hasData: boolean }
  try {
    meta = await authApi.stateMeta(token)
  } catch {
    return 'skip'
  }
  if (!meta.enabled) return 'skip'
  const orgId = useStore.getState().currentOrgId ?? ''
  if (meta.hasData) {
    try {
      const state = await authApi.getState(token)
      suppress = true
      useStore.getState().hydrateFromCloud(orgId, state as never)
      seedPrev()
      setTimeout(() => (suppress = false), 400)
      return 'pulled'
    } catch {
      return 'skip'
    }
  }
  const snap = snapshot()
  const nonEmpty = Object.values(snap).some((a) => a.length)
  if (nonEmpty) {
    try {
      const d = computeDelta() // 首次推：prevRows 空 → 全部当新增 upsert
      await authApi.importSnapshot(token, d.upserts, d.deletes)
      commitDelta()
      return 'pushed'
    } catch {
      return 'skip'
    }
  }
  return 'skip'
}

async function flush(): Promise<void> {
  const token = useAuth.getState().token
  if (!token) return
  if (syncing) {
    debounce = setTimeout(flush, 1200)
    return
  }
  syncing = true
  try {
    const d = computeDelta()
    if (d.changed) {
      await authApi.importSnapshot(token, d.upserts, d.deletes)
      commitDelta()
    }
  } catch {
    /* 下次改动再试（prevRows 未提交，delta 会重算） */
  } finally {
    syncing = false
  }
}

/** 多端收敛：收到 org 'state' 变更信号时重拉领域数据。
 *  有本地待推(debounce 中)或正在同步时跳过，保护未保存的本地改动不被覆盖。 */
export async function rehydrate(token: string): Promise<void> {
  if (debounce || syncing) return
  try {
    const state = await authApi.getState(token)
    const orgId = useStore.getState().currentOrgId ?? ''
    suppress = true
    useStore.getState().hydrateFromCloud(orgId, state as never)
    seedPrev()
    setTimeout(() => (suppress = false), 400)
  } catch {
    /* 忽略，下次信号再试 */
  }
}

/** 订阅本地领域数据变化 → 防抖回写 PG（只在这些切片引用变化时触发） */
export function startAutoSync(): void {
  if (subscribed) return
  subscribed = true
  let prev = snapshot()
  useStore.subscribe(() => {
    if (suppress) return
    const cur = snapshot()
    const changed = SLICES.some((k) => cur[k] !== prev[k])
    if (!changed) return
    prev = cur
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(flush, 3000)
  })
}
