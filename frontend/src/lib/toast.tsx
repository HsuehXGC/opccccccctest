import { useEffect } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

// ── 轻量 toast ────────────────────────────────────────────
// 操作反馈闭环：新建/移动/删除/存版本等动作后弹一条短提示。
// 独立于领域 store，视图或 store action 均可通过 toast() 触发。

export type ToastKind = 'success' | 'info' | 'warn'
export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let tid = 1

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = 'success') => set((s) => ({ toasts: [...s.toasts, { id: tid++, kind, message }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** 便捷入口：非组件上下文（如 store action）里直接触发一条 toast */
export const toast = (message: string, kind?: ToastKind) => useToast.getState().push(message, kind)

const ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
}
const ICON_CLS: Record<ToastKind, string> = {
  success: 'text-emerald-600',
  info: 'text-sky-600',
  warn: 'text-amber-600',
}

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToast((s) => s.dismiss)
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), 3200)
    return () => clearTimeout(id)
  }, [t.id, dismiss])
  const Icon = ICON[t.kind]
  return (
    <div className="toast-in pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-lg">
      <Icon size={16} className={ICON_CLS[t.kind]} />
      <span className="text-sm text-slate-700">{t.message}</span>
      <button onClick={() => dismiss(t.id)} className="ml-1 shrink-0 text-slate-300 hover:text-slate-500">
        <X size={14} />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToast((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  )
}
