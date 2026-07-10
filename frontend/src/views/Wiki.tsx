import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  Plus,
  PenLine,
  History,
  Link2,
  Clock,
  RotateCcw,
  ArrowLeft,
  Tag,
  GitBranch,
  X,
  Check,
  CircleDashed,
  LayoutGrid,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar, DOC_STATUS, DOC_TYPE, DOC_TYPE_ORDER, REL, REL_INVERSE, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { extractLinks, renderMarkdown } from '../lib/markdown'
import type { Bot, DocRelation, DocStatus, DocType, RelType, WikiDoc } from '../types'

const DOC_STATUSES: DocStatus[] = ['draft', 'review', 'approved', 'archived']
const REL_TYPES: RelType[] = ['derives', 'implements', 'verifies', 'decides', 'references']
/** 每个产品默认应有的核心文档类型（蓝图基线） */
const CORE_TYPES = DOC_TYPE_ORDER.filter((t) => DOC_TYPE[t].core)

function fmtDate(ts: number) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── 渲染 Markdown + 可点击互链 ───────────────────────────
function WikiContent({
  content,
  titleBySlug,
  onNavigate,
}: {
  content: string
  titleBySlug: Map<string, string>
  onNavigate: (slug: string) => void
}) {
  const html = useMemo(() => renderMarkdown(content, titleBySlug), [content, titleBySlug])
  return (
    <div
      className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-table:text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a[data-slug]') as HTMLElement | null
        if (a) {
          e.preventDefault()
          const slug = a.getAttribute('data-slug')!
          if (titleBySlug.has(slug)) onNavigate(slug)
        }
      }}
    />
  )
}

// ── 关系面板：类型化上下游 + 添加/删除 ─────────────────────
function RelationsPanel({
  doc,
  productDocs,
  onNavigate,
}: {
  doc: WikiDoc
  productDocs: WikiDoc[]
  onNavigate: (slug: string) => void
}) {
  const addRelation = useStore((s) => s.addRelation)
  const removeRelation = useStore((s) => s.removeRelation)
  const [adding, setAdding] = useState(false)
  const [rel, setRel] = useState<RelType>('derives')
  const [target, setTarget] = useState('')

  const titleOf = (slug: string) => productDocs.find((d) => d.slug === slug)?.title ?? slug
  const incoming = productDocs.flatMap((d) =>
    d.slug === doc.slug ? [] : d.relations.filter((r) => r.target === doc.slug).map((r) => ({ from: d.slug, rel: r.rel })),
  )
  const candidates = productDocs.filter((d) => d.slug !== doc.slug)

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <GitBranch size={13} /> 上下游关系
        </span>
        <button
          onClick={() => {
            setAdding((v) => !v)
            setTarget(candidates[0]?.slug ?? '')
          }}
          className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <Plus size={12} /> 添加关系
        </button>
      </div>

      {adding && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200">
          <span className="text-xs text-slate-500">本文档</span>
          <select value={rel} onChange={(e) => setRel(e.target.value as RelType)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            {REL_TYPES.map((r) => (
              <option key={r} value={r}>
                {REL[r].label}
              </option>
            ))}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs">
            {candidates.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (target) addRelation(doc.slug, { rel, target })
              setAdding(false)
            }}
            className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            添加
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-slate-400">本文档 →</div>
          {doc.relations.length === 0 ? (
            <p className="text-xs text-slate-400">暂无出向关系</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {doc.relations.map((r) => (
                <span
                  key={`${r.rel}-${r.target}`}
                  className={cx('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1', REL[r.rel].cls)}
                >
                  <span className="font-medium">{REL[r.rel].label}</span>
                  <button onClick={() => onNavigate(r.target)} className="hover:underline">
                    {titleOf(r.target)}
                  </button>
                  <button onClick={() => removeRelation(doc.slug, r.rel, r.target)} className="opacity-50 hover:opacity-100">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {incoming.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-slate-400">← 其它文档</div>
            <div className="flex flex-wrap gap-1.5">
              {incoming.map((r) => (
                <button
                  key={`${r.from}-${r.rel}`}
                  onClick={() => onNavigate(r.from)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs ring-1 ring-slate-200 hover:ring-brand"
                >
                  <span className="text-slate-400">{REL_INVERSE[r.rel]}</span>
                  <span className="font-medium">{titleOf(r.from)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 编辑 / 修订：保存即生成新版本 ───────────────────────
function EditModal({ doc, bots, onClose }: { doc: WikiDoc; bots: Bot[]; onClose: () => void }) {
  const saveDocVersion = useStore((s) => s.saveDocVersion)
  const cur = doc.versions[0]
  const [content, setContent] = useState(cur.content)
  const [note, setNote] = useState('')
  const [productVersion, setProductVersion] = useState(cur.productVersion)
  const [status, setStatus] = useState<DocStatus>(cur.status)
  const [ownerBotId, setOwnerBotId] = useState<string | null>(doc.ownerBotId)

  function save() {
    saveDocVersion(doc.slug, {
      content,
      note: note.trim() || '更新内容',
      authorBotId: ownerBotId,
      productVersion,
      status,
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`修订 · ${doc.title}`}>
      <Field label={`正文（Markdown，用 [[slug]] 关联其它文档） · 将生成 ${cur.version} → 新版本`}>
        <textarea
          className={cx(inputCls, 'h-64 resize-y font-mono text-xs leading-relaxed')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="产品版本">
          <input className={inputCls} value={productVersion} onChange={(e) => setProductVersion(e.target.value)} />
        </Field>
        <Field label="状态">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as DocStatus)}>
            {DOC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DOC_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="负责员工">
          <select className={inputCls} value={ownerBotId ?? ''} onChange={(e) => setOwnerBotId(e.target.value || null)}>
            <option value="">未指派</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.role}
              </option>
            ))}
          </select>
        </Field>
        <Field label="修改说明">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="本次改了什么" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          保存为新版本
        </button>
      </div>
    </Modal>
  )
}

// ── 新建文档 ─────────────────────────────────────────
function NewDocModal({
  productId,
  productVersion,
  bots,
  defaults,
  onClose,
  onCreated,
}: {
  productId: string
  productVersion: string
  bots: Bot[]
  defaults?: { type?: DocType; title?: string; slug?: string; relations?: DocRelation[] }
  onClose: () => void
  onCreated: (slug: string) => void
}) {
  const addDoc = useStore((s) => s.addDoc)
  const requirements = useStore((s) => s.requirements)
  const docs = useStore((s) => s.docs)
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [slug, setSlug] = useState(defaults?.slug ?? '')
  const [type, setType] = useState<DocType>(defaults?.type ?? 'prd')
  const [requirementId, setRequirementId] = useState<string | null>(null)
  const [ownerBotId, setOwnerBotId] = useState<string | null>(null)

  const taken = docs.some((d) => d.slug === slug.trim())
  const valid = title.trim() && slug.trim() && !taken

  function create() {
    if (!valid) return
    addDoc({
      slug: slug.trim(),
      title: title.trim(),
      type,
      productId,
      productVersion,
      requirementId,
      ownerBotId,
      relations: defaults?.relations ?? [],
    })
    onCreated(slug.trim())
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="新建产品文档">
      <Field label="标题">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：支付模块 · 技术架构" autoFocus />
      </Field>
      <Field label="slug（唯一标识，用于互链 [[slug]]）">
        <input
          className={cx(inputCls, taken && 'border-rose-400')}
          value={slug}
          onChange={(e) => setSlug(e.target.value.replace(/\s+/g, '-'))}
          placeholder="arch-payment"
        />
        {taken && <span className="mt-1 block text-xs text-rose-500">该 slug 已存在</span>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="类型">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as DocType)}>
            {DOC_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE[t].label}
                {DOC_TYPE[t].core ? ' · 核心' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="产品版本">
          <input className={cx(inputCls, 'bg-slate-50 text-slate-500')} value={productVersion} disabled />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="关联需求">
          <select className={inputCls} value={requirementId ?? ''} onChange={(e) => setRequirementId(e.target.value || null)}>
            <option value="">无</option>
            {requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="指派员工起草">
          <select className={inputCls} value={ownerBotId ?? ''} onChange={(e) => setOwnerBotId(e.target.value || null)}>
            <option value="">未指派</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.role}
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
          onClick={create}
          disabled={!valid}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          创建
        </button>
      </div>
    </Modal>
  )
}

// ── 文档蓝图：核心文档覆盖 / 缺口 ─────────────────────────
function Blueprint({
  productDocs,
  onOpen,
  onDraft,
}: {
  productDocs: WikiDoc[]
  onOpen: (slug: string) => void
  onDraft: (type: DocType) => void
}) {
  const present = new Set(productDocs.map((d) => d.type))
  const covered = CORE_TYPES.filter((t) => present.has(t)).length
  const optionalPresent = DOC_TYPE_ORDER.filter((t) => !DOC_TYPE[t].core && present.has(t))

  return (
    <div className="border-b border-slate-100 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <LayoutGrid size={13} /> 文档蓝图
        <span className="ml-auto font-normal text-slate-400">
          核心 {covered}/{CORE_TYPES.length}
        </span>
      </div>
      <div className="space-y-1">
        {CORE_TYPES.map((t) => {
          const doc = productDocs.find((d) => d.type === t)
          return (
            <div key={t} className="flex items-center gap-2 text-sm">
              {doc ? (
                <Check size={14} className="shrink-0 text-emerald-500" />
              ) : (
                <CircleDashed size={14} className="shrink-0 text-slate-300" />
              )}
              <span className={cx('text-xs', doc ? 'text-slate-600' : 'text-slate-400')}>{DOC_TYPE[t].label}</span>
              {doc ? (
                <button onClick={() => onOpen(doc.slug)} className="ml-auto text-[11px] text-brand hover:underline">
                  查看
                </button>
              ) : (
                <button onClick={() => onDraft(t)} className="ml-auto text-[11px] font-medium text-brand hover:underline">
                  起草
                </button>
              )}
            </div>
          )
        })}
      </div>
      {optionalPresent.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
          <span className="text-[11px] text-slate-400">可选：</span>
          {optionalPresent.map((t) => (
            <span key={t} className={cx('rounded px-1 text-[10px] font-medium', DOC_TYPE[t].chip)}>
              {DOC_TYPE[t].label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function Wiki() {
  const allProducts = useStore((s) => s.products)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const products = allProducts.filter((p) => p.projectId === currentProjectId)
  const docs = useStore((s) => s.docs)
  const bots = useStore((s) => s.bots)
  const setDocStatus = useStore((s) => s.setDocStatus)
  const rollbackDoc = useStore((s) => s.rollbackDoc)

  const focusDoc = useStore((s) => s.focusDoc)
  const clearFocusDoc = useStore((s) => s.clearFocusDoc)

  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const product = products.find((p) => p.id === productId) ?? products[0]
  const productDocs = useMemo(() => docs.filter((d) => d.productId === product?.id), [docs, product])

  const [selected, setSelected] = useState<string>(productDocs[0]?.slug ?? '')
  const [query, setQuery] = useState('')

  // 从其它模块深链到某文档（如从需求跳转过来）
  useEffect(() => {
    if (focusDoc) {
      setProductId(focusDoc.productId)
      setSelected(focusDoc.slug)
      clearFocusDoc()
    }
  }, [focusDoc, clearFocusDoc])
  const [showHistory, setShowHistory] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState<{ type?: DocType; title?: string; slug?: string } | null>(null)

  const botById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])
  const titleBySlug = useMemo(() => new Map(docs.map((d) => [d.slug, d.title])), [docs])

  const doc = productDocs.find((d) => d.slug === selected) ?? productDocs[0]

  const backlinks = useMemo(() => {
    if (!doc) return []
    return productDocs.filter((d) => d.slug !== doc.slug && extractLinks(d.versions[0].content).includes(doc.slug))
  }, [productDocs, doc])

  const filtered = productDocs.filter(
    (d) => d.title.toLowerCase().includes(query.toLowerCase()) || d.slug.includes(query.toLowerCase()),
  )
  const grouped = DOC_TYPE_ORDER.map((t) => ({ type: t, items: filtered.filter((d) => d.type === t) })).filter(
    (g) => g.items.length,
  )

  function select(slug: string) {
    setSelected(slug)
    setPreviewVersion(null)
    setShowHistory(false)
  }

  function switchProduct(id: string) {
    setProductId(id)
    const first = docs.find((d) => d.productId === id)
    setSelected(first?.slug ?? '')
    setPreviewVersion(null)
    setShowHistory(false)
  }

  function draftMissing(type: DocType) {
    const suffix = product.id.replace(/^product-/, '')
    setCreating({ type, title: `${product.name} · ${DOC_TYPE[type].label}`, slug: `${type}-${suffix}` })
  }

  return (
    <div className="flex h-full">
      {/* 文档列表 + 蓝图 */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">产品文档</span>
            <button
              onClick={() => setCreating({})}
              className="flex items-center gap-1 rounded-lg bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={13} /> 新建
            </button>
          </div>
          {/* 产品切换 */}
          <select
            value={product?.id ?? ''}
            onChange={(e) => switchProduct(e.target.value)}
            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-brand/20"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.currentVersion}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索文档…"
              className="w-full rounded-lg bg-slate-50 py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        {product && <Blueprint productDocs={productDocs} onOpen={select} onDraft={draftMissing} />}

        <div className="flex-1 overflow-y-auto p-2">
          {grouped.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">该产品暂无文档</p>}
          {grouped.map((g) => (
            <div key={g.type} className="mb-3">
              <div className={cx('mb-1 px-2 text-[11px] font-bold uppercase tracking-wide', DOC_TYPE[g.type].cls)}>
                {DOC_TYPE[g.type].label}
              </div>
              {g.items.map((d) => (
                <button
                  key={d.slug}
                  onClick={() => select(d.slug)}
                  className={cx(
                    'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition',
                    doc && d.slug === doc.slug ? 'bg-brand-soft text-brand' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <span className="flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{d.versions[0].version}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 文档正文 */}
      <div className="flex-1 overflow-y-auto">
        {!doc ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
            <p>「{product?.name}」还没有文档</p>
            <p className="text-sm">从左侧「文档蓝图」起草核心文档，或点「新建」。</p>
          </div>
        ) : (
          <DocDetail
            doc={doc}
            productDocs={productDocs}
            productName={product.name}
            titleBySlug={titleBySlug}
            backlinks={backlinks}
            previewVersion={previewVersion}
            botById={botById}
            onNavigate={select}
            onEdit={() => setEditing(true)}
            onToggleHistory={() => setShowHistory((v) => !v)}
            showHistory={showHistory}
            onSetStatus={(st) => setDocStatus(doc.slug, st)}
            onPreviewVersion={setPreviewVersion}
          />
        )}
      </div>

      {/* 版本历史面板 */}
      {showHistory && doc && (
        <div className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <History size={15} /> 版本历史
            </span>
            <span className="text-xs text-slate-400">{doc.versions.length} 个版本</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {doc.versions.map((v, i) => {
              const author = v.authorBotId ? botById.get(v.authorBotId) : null
              const isViewing = previewVersion ? previewVersion === v.version : i === 0
              return (
                <div
                  key={v.version}
                  className={cx('mb-2 rounded-xl border p-3', isViewing ? 'border-brand/40 bg-brand-soft/40' : 'border-slate-200')}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-semibold">{v.version}</span>
                    {i === 0 && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">当前</span>
                    )}
                    <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-medium', DOC_STATUS[v.status].cls)}>
                      {DOC_STATUS[v.status].label}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">{v.productVersion}</span>
                  </div>
                  <p className="mb-1.5 text-xs text-slate-600">{v.note}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    {author && <Avatar seed={author.avatarSeed} name={author.name} size={14} />}
                    <span>{author?.name ?? '—'}</span>
                    <span>·</span>
                    <span>{fmtDate(v.createdAt)}</span>
                  </div>
                  {i !== 0 && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => setPreviewVersion(previewVersion === v.version ? null : v.version)}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        {previewVersion === v.version ? '收起' : '预览'}
                      </button>
                      <button
                        onClick={() => {
                          rollbackDoc(doc.slug, v.version)
                          setPreviewVersion(null)
                        }}
                        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand"
                      >
                        <RotateCcw size={11} /> 回滚到此版本
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editing && doc && <EditModal doc={doc} bots={bots} onClose={() => setEditing(false)} />}
      {creating && product && (
        <NewDocModal
          productId={product.id}
          productVersion={product.currentVersion}
          bots={bots}
          defaults={creating}
          onClose={() => setCreating(null)}
          onCreated={select}
        />
      )}
    </div>
  )
}

// ── 文档详情 ─────────────────────────────────────────
function DocDetail({
  doc,
  productDocs,
  productName,
  titleBySlug,
  backlinks,
  previewVersion,
  botById,
  onNavigate,
  onEdit,
  onToggleHistory,
  showHistory,
  onSetStatus,
  onPreviewVersion,
}: {
  doc: WikiDoc
  productDocs: WikiDoc[]
  productName: string
  titleBySlug: Map<string, string>
  backlinks: WikiDoc[]
  previewVersion: string | null
  botById: Map<string, Bot>
  onNavigate: (slug: string) => void
  onEdit: () => void
  onToggleHistory: () => void
  showHistory: boolean
  onSetStatus: (s: DocStatus) => void
  onPreviewVersion: (v: string | null) => void
}) {
  const cur = doc.versions[0]
  const shown = previewVersion ? doc.versions.find((v) => v.version === previewVersion)! : cur
  const owner = doc.ownerBotId ? botById.get(doc.ownerBotId) : null

  return (
    <div className="mx-auto max-w-3xl px-8 py-7">
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold', DOC_TYPE[doc.type].chip)}>
            {DOC_TYPE[doc.type].abbr}
          </span>
          {DOC_TYPE[doc.type].core && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">核心</span>
          )}
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {productName}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            <Tag size={11} /> 产品 {cur.productVersion}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            <History size={11} /> {cur.version}
          </span>
          <select
            value={cur.status}
            onChange={(e) => onSetStatus(e.target.value as DocStatus)}
            className={cx('rounded-md px-2 py-0.5 text-xs font-medium', DOC_STATUS[cur.status].cls)}
          >
            {DOC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DOC_STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
          {owner ? (
            <span className="flex items-center gap-1.5">
              <Avatar seed={owner.avatarSeed} name={owner.name} size={18} /> {owner.name}
            </span>
          ) : (
            <span>未指派负责人</span>
          )}
          <span className="flex items-center gap-1">
            <Clock size={11} /> {fmtDate(cur.createdAt)}
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-mono text-slate-400">{doc.slug}</span>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <PenLine size={14} /> 修订
          </button>
          <button
            onClick={onToggleHistory}
            className={cx(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition',
              showHistory ? 'bg-brand-soft text-brand ring-brand/30' : 'text-slate-600 ring-slate-200 hover:bg-slate-50',
            )}
          >
            <History size={14} /> 版本历史 · {doc.versions.length}
          </button>
        </div>
      </div>

      {previewVersion && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          <span>正在查看历史版本 {previewVersion}（只读）</span>
          <button onClick={() => onPreviewVersion(null)} className="flex items-center gap-1 font-medium hover:underline">
            <ArrowLeft size={13} /> 返回当前
          </button>
        </div>
      )}

      <WikiContent content={shown.content} titleBySlug={titleBySlug} onNavigate={onNavigate} />

      <RelationsPanel doc={doc} productDocs={productDocs} onNavigate={onNavigate} />

      <div className="mt-6 border-t border-slate-100 pt-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
          <Link2 size={13} /> 正文引用 · {backlinks.length}
        </div>
        {backlinks.length === 0 ? (
          <p className="text-sm text-slate-400">还没有其它文档在正文里引用本篇。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {backlinks.map((b) => (
              <button
                key={b.slug}
                onClick={() => onNavigate(b.slug)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:border-brand hover:bg-brand-soft"
              >
                <span className={cx('rounded px-1 text-[10px] font-semibold', DOC_TYPE[b.type].chip)}>
                  {DOC_TYPE[b.type].abbr}
                </span>
                {b.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
