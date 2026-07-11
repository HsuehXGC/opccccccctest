import { useAuth } from '../store/useAuth'

// ── 客户端事件总线：订阅后端「changed」推送，实现多设备实时 ──────────
type Handler = (kind: string) => void
const handlers = new Set<Handler>()
let ws: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | null = null

export function onCloudChange(fn: Handler): () => void {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

export function connectBus(): void {
  const token = useAuth.getState().token
  if (!token) return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  const url = location.origin.replace(/^http/, 'ws') + '/ws'
  try {
    ws = new WebSocket(url)
  } catch {
    return
  }
  ws.addEventListener('open', () => ws?.send(JSON.stringify({ t: 'auth', token })))
  ws.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(String(ev.data))
      if (m.t === 'changed') handlers.forEach((h) => h(m.kind))
    } catch {
      /* 忽略坏帧 */
    }
  })
  ws.addEventListener('close', () => {
    ws = null
    if (retry) clearTimeout(retry)
    // 仍登录则 5 秒后重连
    if (useAuth.getState().token) retry = setTimeout(connectBus, 5000)
  })
  ws.addEventListener('error', () => ws?.close())
}
