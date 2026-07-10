import type { ReactNode } from 'react'
import type { BotStatus, DocPhase, DocStatus, DocType, Priority, RelType, TaskStatus } from '../types'

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

// ── 优先级 ─────────────────────────────
export const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  low: { label: '低', cls: 'bg-slate-100 text-slate-600' },
  medium: { label: '中', cls: 'bg-sky-100 text-sky-700' },
  high: { label: '高', cls: 'bg-amber-100 text-amber-700' },
  urgent: { label: '紧急', cls: 'bg-rose-100 text-rose-700' },
}

// ── 任务列 ─────────────────────────────
export const TASK_COLUMNS: { key: TaskStatus; label: string; accent: string }[] = [
  { key: 'backlog', label: '待分配', accent: 'bg-slate-400' },
  { key: 'in_progress', label: '进行中', accent: 'bg-indigo-500' },
  { key: 'review', label: '待复核', accent: 'bg-amber-500' },
  { key: 'done', label: '已完成', accent: 'bg-emerald-500' },
]

// ── 机器人状态 ─────────────────────────
export const BOT_STATUS: Record<BotStatus, { label: string; dot: string; text: string }> = {
  idle: { label: '空闲', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  working: { label: '工作中', dot: 'bg-indigo-500', text: 'text-indigo-600' },
  paused: { label: '已暂停', dot: 'bg-amber-500', text: 'text-amber-600' },
  offline: { label: '离线', dot: 'bg-slate-400', text: 'text-slate-500' },
}

// ── 生命周期阶段 ───────────────────────
export const DOC_PHASE: { key: DocPhase; label: string; index: string }[] = [
  { key: 'define', label: '定义', index: '①' },
  { key: 'plan', label: '规划', index: '②' },
  { key: 'design', label: '设计', index: '③' },
  { key: 'verify', label: '验证', index: '④' },
  { key: 'release', label: '发布', index: '⑤' },
]

// ── 文档类型 ───────────────────────────
// core=true 为每个产品默认应有的核心文档；其余为按需启用的可选文档。
type DocTypeMeta = { label: string; abbr: string; phase: DocPhase; core: boolean; cls: string; chip: string }
export const DOC_TYPE: Record<DocType, DocTypeMeta> = {
  vision: { label: '愿景/BRD', abbr: 'BRD', phase: 'define', core: false, cls: 'text-rose-600', chip: 'bg-rose-100 text-rose-700' },
  prd: { label: '产品需求', abbr: 'PRD', phase: 'plan', core: true, cls: 'text-indigo-600', chip: 'bg-indigo-100 text-indigo-700' },
  story: { label: '用户故事', abbr: 'STORY', phase: 'plan', core: false, cls: 'text-sky-600', chip: 'bg-sky-100 text-sky-700' },
  arch: { label: '技术架构', abbr: 'ARCH', phase: 'design', core: true, cls: 'text-cyan-600', chip: 'bg-cyan-100 text-cyan-700' },
  api: { label: '接口契约', abbr: 'API', phase: 'design', core: true, cls: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700' },
  data: { label: '数据模型', abbr: 'DATA', phase: 'design', core: false, cls: 'text-teal-600', chip: 'bg-teal-100 text-teal-700' },
  design: { label: '视觉设计', abbr: 'DESIGN', phase: 'design', core: false, cls: 'text-pink-600', chip: 'bg-pink-100 text-pink-700' },
  adr: { label: '决策记录', abbr: 'ADR', phase: 'design', core: false, cls: 'text-violet-600', chip: 'bg-violet-100 text-violet-700' },
  test: { label: '测试计划', abbr: 'TEST', phase: 'verify', core: true, cls: 'text-amber-600', chip: 'bg-amber-100 text-amber-700' },
  release: { label: '发布说明', abbr: 'RELEASE', phase: 'release', core: false, cls: 'text-lime-600', chip: 'bg-lime-100 text-lime-700' },
}

/** 界面中文档类型的展示顺序（按生命周期） */
export const DOC_TYPE_ORDER: DocType[] = ['vision', 'prd', 'story', 'arch', 'api', 'data', 'design', 'adr', 'test', 'release']

// ── 类型化关系 ─────────────────────────
export const REL: Record<RelType, { label: string; cls: string }> = {
  derives: { label: '派生自', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  implements: { label: '实现', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  verifies: { label: '验证', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  decides: { label: '决策支撑', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  references: { label: '引用', cls: 'bg-slate-50 text-slate-600 ring-slate-200' },
}
/** 反向关系的中文表述（用于「被…」展示） */
export const REL_INVERSE: Record<RelType, string> = {
  derives: '派生出',
  implements: '被实现',
  verifies: '被验证',
  decides: '决策了',
  references: '被引用',
}

// ── 文档状态 ───────────────────────────
export const DOC_STATUS: Record<DocStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
  review: { label: '评审中', cls: 'bg-sky-100 text-sky-700' },
  approved: { label: '已定稿', cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: '已归档', cls: 'bg-slate-100 text-slate-400' },
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function PriorityBadge({ p }: { p: Priority }) {
  const { label, cls } = PRIORITY[p]
  return <Badge className={cls}>{label}</Badge>
}

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#7c3aed', '#db2777', '#059669', '#d97706', '#dc2626']
export function Avatar({ seed, name, size = 36 }: { seed: string; name: string; size?: number }) {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length]
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function StatusDot({ status }: { status: BotStatus }) {
  const s = BOT_STATUS[status]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('h-2 w-2 rounded-full', s.dot, status === 'working' && 'dot-pulse')} />
      <span className={cx('text-xs font-medium', s.text)}>{s.label}</span>
    </span>
  )
}
