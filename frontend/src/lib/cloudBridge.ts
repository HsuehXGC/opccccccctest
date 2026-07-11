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
      await authApi.importSnapshot(token, snap)
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
    await authApi.importSnapshot(token, snapshot())
  } catch {
    /* 下次改动再试 */
  } finally {
    syncing = false
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
