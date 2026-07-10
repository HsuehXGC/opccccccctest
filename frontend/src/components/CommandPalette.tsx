import { useEffect, useRef, useState } from 'react'
import {
  CornerDownLeft,
  FileText,
  KanbanSquare,
  Layers,
  LayoutDashboard,
  Search,
  Target,
  UserCog,
  Users,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { DOC_TYPE, cx } from '../lib/ui'

interface Cmd {
  id: string
  group: string
  label: string
  sub?: string
  icon: typeof Target
  run: () => void
}

// 无查询时每个「内容」分组最多展示的条数（导航分组不限）
const EMPTY_CAP = 5

// 挂载即打开：由父组件条件渲染（<CommandPalette> 仅在打开时挂载），
// 因此所有 hook 恒定执行，无需早返回，避免 Hooks 顺序问题。
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const setView = useStore((s) => s.setView)
  const openDoc = useStore((s) => s.openDoc)
  const openTask = useStore((s) => s.openTask)
  const openProduct = useStore((s) => s.openProduct)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const products = useStore((s) => s.products)
  const requirements = useStore((s) => s.requirements)
  const docs = useStore((s) => s.docs)
  const tasks = useStore((s) => s.tasks)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 挂载后聚焦输入框
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const scopedProducts = products.filter((p) => p.projectId === currentProjectId)
  const pids = new Set(scopedProducts.map((p) => p.id))

  const nav: Cmd[] = [
    { id: 'v-dashboard', group: '导航', label: '概览', icon: LayoutDashboard, run: () => setView('dashboard') },
    { id: 'v-requirements', group: '导航', label: '需求管理', icon: Target, run: () => setView('requirements') },
    { id: 'v-wiki', group: '导航', label: '产品文档', icon: FileText, run: () => setView('wiki') },
    { id: 'v-kanban', group: '导航', label: '任务看板', icon: KanbanSquare, run: () => setView('kanban') },
    { id: 'v-workforce', group: '导航', label: '虚拟人力', icon: Users, run: () => setView('workforce') },
    { id: 'v-account', group: '导航', label: '团队与账户', icon: UserCog, run: () => setView('account') },
  ]
  const prod: Cmd[] = scopedProducts.map((p) => ({
    id: `p-${p.id}`,
    group: '产品',
    label: p.name,
    sub: p.currentVersion,
    icon: Layers,
    run: () => openProduct(p.id),
  }))
  const reqs: Cmd[] = requirements
    .filter((r) => r.productId && pids.has(r.productId))
    .map((r) => ({
      id: `r-${r.id}`,
      group: '需求',
      label: r.title,
      sub: r.description,
      icon: Target,
      run: () => openProduct(r.productId!),
    }))
  const dcs: Cmd[] = docs
    .filter((d) => pids.has(d.productId))
    .map((d) => ({
      id: `d-${d.slug}`,
      group: '文档',
      label: d.title,
      sub: DOC_TYPE[d.type].label,
      icon: FileText,
      run: () => openDoc(d.productId, d.slug),
    }))
  const tks: Cmd[] = tasks
    .filter((t) => t.productId && pids.has(t.productId))
    .map((t) => ({
      id: `t-${t.id}`,
      group: '任务',
      label: t.title,
      sub: t.description,
      icon: KanbanSquare,
      run: () => openTask(t.id),
    }))

  const groups: Cmd[][] = [nav, prod, reqs, dcs, tks]
  const needle = q.trim().toLowerCase()
  const flat: Cmd[] = groups.flatMap((g) => {
    if (!needle) return g[0]?.group === '导航' ? g : g.slice(0, EMPTY_CAP)
    return g.filter((c) => (c.label + ' ' + (c.sub ?? '')).toLowerCase().includes(needle))
  })

  const selected = Math.min(sel, Math.max(0, flat.length - 1))

  function choose(cmd: Cmd | undefined) {
    if (!cmd) return
    cmd.run()
    onClose()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min((flat.length ? s : 0) + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(flat[selected])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // 选中项滚动进视野
  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  })

  // 渲染时按分组分段，同时记录扁平索引以对齐选中态
  let idx = -1

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
          <Search size={17} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKey}
            placeholder="搜索产品 / 需求 / 文档 / 任务，或跳转视图…"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {flat.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">没有匹配的结果</div>}
          {groups.map((g, gi) => {
            const items = !needle
              ? g[0]?.group === '导航'
                ? g
                : g.slice(0, EMPTY_CAP)
              : g.filter((c) => (c.label + ' ' + (c.sub ?? '')).toLowerCase().includes(needle))
            if (items.length === 0) return null
            return (
              <div key={gi} className="mb-1">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {items[0].group}
                </div>
                {items.map((c) => {
                  idx++
                  const i = idx
                  const Icon = c.icon
                  const active = i === selected
                  return (
                    <button
                      key={c.id}
                      ref={(el) => {
                        itemRefs.current[i] = el
                      }}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => choose(c)}
                      className={cx(
                        'flex w-full items-center gap-3 px-4 py-2 text-left',
                        active ? 'bg-brand-soft' : 'hover:bg-slate-50',
                      )}
                    >
                      <Icon size={16} className={active ? 'text-brand' : 'text-slate-400'} />
                      <span className={cx('shrink-0 text-sm', active ? 'font-medium text-brand' : 'text-slate-700')}>
                        {c.label}
                      </span>
                      {c.sub && <span className="ml-auto truncate pl-3 text-xs text-slate-400">{c.sub}</span>}
                      {active && <CornerDownLeft size={13} className="ml-2 shrink-0 text-brand/60" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
