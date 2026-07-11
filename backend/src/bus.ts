// ── 客户端事件总线 ─────────────────────────────────────────────
// 后端在 job / 会议状态变化时，向对应账户组的所有 WS 客户端推「changed」信号，
// 客户端据此立即拉取最新（替代/补充轮询，实现多设备实时）。

interface Conn {
  orgId: string
  send: (s: string) => void
}

const conns = new Set<Conn>()

export function addBusConn(c: Conn): () => void {
  conns.add(c)
  return () => conns.delete(c)
}

/** 向某账户组所有客户端推变更信号；kind 便于客户端决定拉什么 */
export function notifyOrg(orgId: string, kind: 'jobs' | 'meetings' | 'state'): void {
  if (conns.size === 0) return
  const msg = JSON.stringify({ t: 'changed', kind })
  for (const c of conns) {
    if (c.orgId === orgId) {
      try {
        c.send(msg)
      } catch {
        /* 忽略断开的连接 */
      }
    }
  }
}
