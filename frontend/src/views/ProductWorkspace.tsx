import { useMemo, useState } from 'react'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  PenLine,
  FileText,
  Sparkles,
  ExternalLink,
  Layers,
  ListTodo,
  ArrowRight,
  Target,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { DOC_TYPE, DOC_TYPE_ORDER, PriorityBadge, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { renderMarkdown } from '../lib/markdown'
import type { Priority, Requirement, RequirementStatus } from '../types'

const REQ_STATUS: Record<RequirementStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
  planning: { label: '规划中', cls: 'bg-sky-100 text-sky-700' },
  active: { label: '执行中', cls: 'bg-indigo-100 text-indigo-700' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700' },
}
const REQ_STATUSES: RequirementStatus[] = ['draft', 'planning', 'active', 'done']
const CORE_TYPES = DOC_TYPE_ORDER.filter((t) => DOC_TYPE[t].core)

const TASK_DOT: Record<string, string> = {
  backlog: 'bg-slate-300',
  in_progress: 'bg-indigo-500',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
}

// ── 文档形式的需求正文 ────────────────────────────────
function ReqBody({
  content,
  titleBySlug,
  onOpenDoc,
}: {
  content: string
  titleBySlug: Map<string, string>
  onOpenDoc: (slug: string) => void
}) {
  const html = useMemo(() => renderMarkdown(content, titleBySlug), [content, titleBySlug])
  return (
    <div
      className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-h2:text-base prose-pre:bg-slate-900 prose-pre:text-slate-100"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a[data-slug]') as HTMLElement | null
        if (a) {
          e.preventDefault()
          const slug = a.getAttribute('data-slug')!
          if (titleBySlug.has(slug)) onOpenDoc(slug)
        }
      }}
    />
  )
}

// ── 新建 / 编辑需求 ───────────────────────────────────
function ReqModal({
  edit,
  onClose,
  onSubmit,
}: {
  edit?: Requirement
  onClose: () => void
  onSubmit: (v: { title: string; description: string; content: string; priority: Priority; status: RequirementStatus }) => void
}) {
  const [title, setTitle] = useState(edit?.title ?? '')
  const [description, setDescription] = useState(edit?.description ?? '')
  const [content, setContent] = useState(edit?.content ?? '## 目标\n\n## 范围\n')
  const [priority, setPriority] = useState<Priority>(edit?.priority ?? 'medium')
  const [status, setStatus] = useState<RequirementStatus>(edit?.status ?? 'planning')

  return (
    <Modal open onClose={onClose} title={edit ? `编辑需求 · ${edit.title}` : '新建需求'}>
      <Field label="标题">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：上线企业官网 v2" autoFocus />
      </Field>
      <Field label="一句话摘要">
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="列表卡片上展示" />
      </Field>
      <Field label="需求正文（Markdown，可用 [[slug]] 关联产品文档）">
        <textarea
          className={cx(inputCls, 'h-48 resize-y font-mono text-xs leading-relaxed')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="优先级">
          <div className="flex gap-1.5">
            {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={cx(
                  'flex-1 rounded-lg border py-1.5 text-xs font-medium transition',
                  priority === p ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500',
                )}
              >
                {{ low: '低', medium: '中', high: '高', urgent: '紧急' }[p]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="状态">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as RequirementStatus)}>
            {REQ_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQ_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button
          onClick={() => {
            if (!title.trim()) return
            onSubmit({ title: title.trim(), description: description.trim(), content, priority, status })
            onClose()
          }}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {edit ? '保存' : '创建需求'}
        </button>
      </div>
    </Modal>
  )
}

// ── 需求文档卡（可展开） ──────────────────────────────
function RequirementCard({
  req,
  expanded,
  onToggle,
  onEdit,
}: {
  req: Requirement
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  // selector 返回稳定的整表引用，过滤放在渲染体里（避免 Zustand v5 无限重渲染）
  const allTasks = useStore((s) => s.tasks)
  const allDocs = useStore((s) => s.docs)
  const tasks = allTasks.filter((t) => t.requirementId === req.id)
  const linkedDocs = allDocs.filter((d) => d.requirementId === req.id)
  const updateRequirement = useStore((s) => s.updateRequirement)
  const addTask = useStore((s) => s.addTask)
  const openDoc = useStore((s) => s.openDoc)

  const titleBySlug = useMemo(() => new Map(allDocs.map((d) => [d.slug, d.title])), [allDocs])
  const done = tasks.filter((t) => t.status === 'done').length

  function openSlug(slug: string) {
    const d = allDocs.find((x) => x.slug === slug)
    if (d) openDoc(d.productId, d.slug)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50">
        {expanded ? (
          <ChevronDown size={18} className="shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={18} className="shrink-0 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{req.title}</span>
            <PriorityBadge p={req.priority} />
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', REQ_STATUS[req.status].cls)}>
              {REQ_STATUS[req.status].label}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{req.description || '暂无摘要'}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-400 sm:flex">
          <span className="flex items-center gap-1">
            <FileText size={12} /> {linkedDocs.length}
          </span>
          <span className="flex items-center gap-1">
            <ListTodo size={12} /> {done}/{tasks.length}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <select
              value={req.status}
              onChange={(e) => updateRequirement(req.id, { status: e.target.value as RequirementStatus })}
              className={cx('rounded-md px-2 py-1 text-xs font-medium', REQ_STATUS[req.status].cls)}
            >
              {REQ_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQ_STATUS[s].label}
                </option>
              ))}
            </select>
            <button
              onClick={onEdit}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              <PenLine size={13} /> 编辑
            </button>
          </div>

          <ReqBody content={req.content} titleBySlug={titleBySlug} onOpenDoc={openSlug} />

          {/* 关联文档 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <FileText size={13} /> 关联文档 · {linkedDocs.length}
            </div>
            {linkedDocs.length === 0 ? (
              <p className="text-sm text-slate-400">还没有关联的产品文档。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {linkedDocs.map((d) => (
                  <button
                    key={d.slug}
                    onClick={() => openDoc(d.productId, d.slug)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:border-brand hover:bg-brand-soft"
                  >
                    <span className={cx('rounded px-1 text-[10px] font-semibold', DOC_TYPE[d.type].chip)}>
                      {DOC_TYPE[d.type].abbr}
                    </span>
                    {d.title}
                    <ExternalLink size={12} className="text-slate-400" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 派生任务 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                <ListTodo size={13} /> 派生任务 · {done}/{tasks.length}
              </span>
              <button
                onClick={() =>
                  addTask({
                    title: `${req.title} · 新子任务`,
                    description: '待补充执行细节',
                    priority: req.priority,
                    requirementId: req.id,
                  })
                }
                className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              >
                <Sparkles size={13} /> 拆解任务
              </button>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400">还没有拆解出任务。</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', TASK_DOT[t.status])} />
                    <span className="flex-1 truncate text-sm">{t.title}</span>
                    <span className="text-xs text-slate-400">{t.progress}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProductWorkspace() {
  const allProducts = useStore((s) => s.products)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const requirements = useStore((s) => s.requirements)
  const docs = useStore((s) => s.docs)
  const tasks = useStore((s) => s.tasks)
  const addRequirement = useStore((s) => s.addRequirement)
  const updateRequirement = useStore((s) => s.updateRequirement)
  const addProduct = useStore((s) => s.addProduct)
  const openDoc = useStore((s) => s.openDoc)
  const setView = useStore((s) => s.setView)

  // 当前项目下的产品
  const products = allProducts.filter((p) => p.projectId === currentProjectId)
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const product = products.find((p) => p.id === productId) ?? products[0]
  const [addingProduct, setAddingProduct] = useState(false)
  const [npName, setNpName] = useState('')
  const [npVersion, setNpVersion] = useState('v1.0.0')

  const productReqs = requirements.filter((r) => r.productId === product?.id)
  const productDocs = docs.filter((d) => d.productId === product?.id)
  const productTasks = tasks.filter((t) => productReqs.some((r) => r.taskIds.includes(t.id) || t.requirementId === r.id))

  const [expanded, setExpanded] = useState<Set<string>>(new Set(productReqs[0] ? [productReqs[0].id] : []))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Requirement | null>(null)

  const presentTypes = new Set(productDocs.map((d) => d.type))
  const coreCovered = CORE_TYPES.filter((t) => presentTypes.has(t)).length
  const tasksDone = productTasks.filter((t) => t.status === 'done').length

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function createProduct() {
    if (!npName.trim()) return
    const id = addProduct({ name: npName.trim(), description: '', currentVersion: npVersion.trim() || 'v1.0.0' })
    setProductId(id)
    setNpName('')
    setNpVersion('v1.0.0')
    setAddingProduct(false)
  }

  const productModalEl = addingProduct && (
    <Modal open onClose={() => setAddingProduct(false)} title="新建产品">
      <Field label="产品名称">
        <input className={inputCls} value={npName} onChange={(e) => setNpName(e.target.value)} placeholder="例如：会员小程序" autoFocus />
      </Field>
      <Field label="初始版本">
        <input className={inputCls} value={npVersion} onChange={(e) => setNpVersion(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => setAddingProduct(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button onClick={createProduct} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          创建
        </button>
      </div>
    </Modal>
  )

  if (!product) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-400">
        <p>本项目还没有产品</p>
        <button
          onClick={() => setAddingProduct(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={15} /> 新建产品
        </button>
        {productModalEl}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 产品切换 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">产品线</div>
          <button onClick={() => setAddingProduct(true)} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <Plus size={13} /> 新建
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3">
          {products.map((p) => {
            const reqs = requirements.filter((r) => r.productId === p.id)
            const active = p.id === product.id
            return (
              <button
                key={p.id}
                onClick={() => {
                  setProductId(p.id)
                  const first = requirements.find((r) => r.productId === p.id)
                  setExpanded(new Set(first ? [first.id] : []))
                }}
                className={cx(
                  'w-full rounded-xl border px-3 py-2.5 text-left transition',
                  active ? 'border-brand/30 bg-brand-soft' : 'border-transparent hover:bg-slate-50',
                )}
              >
                <div className={cx('text-sm font-semibold', active ? 'text-brand' : 'text-slate-700')}>{p.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>{p.currentVersion}</span>
                  <span>·</span>
                  <span>{reqs.length} 需求</span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* 工作台 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-7">
          {/* 产品头部 */}
          <header className="mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {product.currentVersion}
                  </span>
                </div>
                <p className="text-sm text-slate-500">{product.description}</p>
              </div>
            </div>
            {/* 概要 */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200">
                <Target size={14} className="text-brand" /> 需求 <b className="font-semibold">{productReqs.length}</b>
              </span>
              <button
                onClick={() => openFirstDoc(productDocs, openDoc, () => setView('wiki'))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200 hover:ring-brand"
              >
                <Layers size={14} className="text-brand" /> 核心文档{' '}
                <b className="font-semibold">
                  {coreCovered}/{CORE_TYPES.length}
                </b>
              </button>
              <button
                onClick={() => setView('kanban')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200 hover:ring-brand"
              >
                <ListTodo size={14} className="text-brand" /> 任务{' '}
                <b className="font-semibold">
                  {tasksDone}/{productTasks.length}
                </b>
              </button>
            </div>
          </header>

          {/* 文档蓝图缺口提示 */}
          {coreCovered < CORE_TYPES.length && (
            <div className="mb-6 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
              <span>
                核心文档还缺{' '}
                {CORE_TYPES.filter((t) => !presentTypes.has(t))
                  .map((t) => DOC_TYPE[t].label)
                  .join('、')}
              </span>
              <button onClick={() => setView('wiki')} className="flex items-center gap-1 font-medium hover:underline">
                去文档中心补齐 <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* 需求（文档形式） */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              <Target size={15} /> 需求 · {productReqs.length}
            </h2>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={15} /> 新建需求
            </button>
          </div>

          {productReqs.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
              「{product.name}」还没有需求，点「新建需求」开始。
            </div>
          ) : (
            <div className="space-y-3">
              {productReqs.map((r) => (
                <RequirementCard
                  key={r.id}
                  req={r}
                  expanded={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <ReqModal
          onClose={() => setCreating(false)}
          onSubmit={(v) => addRequirement({ ...v, productId: product.id })}
        />
      )}
      {editing && (
        <ReqModal
          edit={editing}
          onClose={() => setEditing(null)}
          onSubmit={(v) => updateRequirement(editing.id, v)}
        />
      )}
      {productModalEl}
    </div>
  )
}

// 打开该产品第一篇文档（没有则仅切到文档中心）
function openFirstDoc(
  productDocs: { productId: string; slug: string }[],
  openDoc: (productId: string, slug: string) => void,
  fallback: () => void,
) {
  const d = productDocs[0]
  if (d) openDoc(d.productId, d.slug)
  else fallback()
}
