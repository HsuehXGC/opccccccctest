import { Fragment, useEffect, useMemo, useState } from 'react'
import { Users, Plus, Play, Loader2, Send, Sparkles, Trash2, FileText, ArrowLeft, Bot as BotIcon, ClipboardList, ListPlus } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi } from '../lib/authApi'
import { onCloudChange } from '../lib/cloudBus'
import { buildProjectKnowledge, parseMeetingPlan, parseDocManifest, docAuthorPrompt, turnHead, turnTail, roundDirectiveText, pmHead, pmTail, MEETING_KIND } from '../lib/meeting'
import { renderMarkdown } from '../lib/markdown'
import { Avatar, cx, DOC_TYPE, DOC_TYPE_ORDER } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { toast } from '../lib/toast'
import type { Bot, DocType, Meeting, MeetingKind, Product } from '../types'

const KIND_CLS: Record<MeetingKind, string> = {
  kickoff: 'bg-indigo-100 text-indigo-700',
  change: 'bg-amber-100 text-amber-700',
  standup: 'bg-slate-100 text-slate-600',
  docgen: 'bg-emerald-100 text-emerald-700',
}

// ── 发起会议 ─────────────────────────────────────────────
function CreateMeeting({ orgBots, products, onClose, onCreated }: { orgBots: Bot[]; products: Product[]; onClose: () => void; onCreated: (id: string) => void }) {
  const createMeeting = useStore((s) => s.createMeeting)
  const allDocs = useStore((s) => s.docs)
  const [title, setTitle] = useState('')
  const [agenda, setAgenda] = useState('')
  const [kind, setKind] = useState<MeetingKind>('kickoff')
  const [productId, setProductId] = useState<string | null>(products[0]?.id ?? null)
  const [picked, setPicked] = useState<string[]>(orgBots.filter((b) => ['产品经理', '项目经理'].includes(b.role)).map((b) => b.id))
  const [references, setReferences] = useState('')
  const [fullDocs, setFullDocs] = useState<string[]>([])
  const [parallel, setParallel] = useState(false)
  const [rounds, setRounds] = useState(1)

  const productIds = new Set(products.map((p) => p.id))
  const projectDocs = allDocs.filter((d) => productIds.has(d.productId))
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleDoc = (slug: string) => setFullDocs((f) => (f.includes(slug) ? f.filter((x) => x !== slug) : [...f, slug]))

  return (
    <Modal open onClose={onClose} title="发起会议">
      <Field label="会议主题">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：报告生成模块立项" autoFocus />
      </Field>
      <Field label="聚焦产品（背景知识库覆盖整个项目的全部产品）">
        {products.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">当前项目还没有产品，会议将缺少产品背景。可先去「需求管理」建产品。</p>
        ) : (
          <>
            <select className={inputCls} value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
              <option value="">整个项目（不聚焦单一产品）</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  聚焦：{p.name}（{p.currentVersion}）
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">背景始终包含项目下全部产品的需求/文档/任务；聚焦产品会额外提供其核心文档正文摘要。</p>
          </>
        )}
      </Field>
      <Field label="会议类型">
        <div className="flex gap-1.5">
          {(Object.keys(MEETING_KIND) as MeetingKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cx('flex-1 rounded-lg border py-2 text-sm font-medium transition', kind === k ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
            >
              {MEETING_KIND[k].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="议题 / 背景">
        <textarea className={cx(inputCls, 'h-24 resize-y')} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder={MEETING_KIND[kind].hint} />
      </Field>
      <Field label="补充背景资料（可选，作为会议背景注入，不截断）">
        <textarea
          className={cx(inputCls, 'h-20 resize-y')}
          value={references}
          onChange={(e) => setReferences(e.target.value)}
          placeholder="粘贴任何额外背景：市场信息、约束、决策依据、外部资料摘要…"
        />
      </Field>
      <Field label={`全文纳入的文档 · ${fullDocs.length}${projectDocs.length ? `（其余文档只给摘要/标题）` : ''}`}>
        {projectDocs.length === 0 ? (
          <p className="text-xs text-slate-400">当前项目暂无文档。</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {projectDocs.map((d) => (
              <label key={d.slug} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                <input type="checkbox" checked={fullDocs.includes(d.slug)} onChange={() => toggleDoc(d.slug)} className="accent-brand" />
                <span className="truncate">{d.title}</span>
              </label>
            ))}
          </div>
        )}
      </Field>
      <Field label={`参会虚拟人力 · ${picked.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {orgBots.map((b) => (
            <button
              key={b.id}
              onClick={() => toggle(b.id)}
              className={cx('flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition', picked.includes(b.id) ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
            >
              <Avatar seed={b.avatarSeed} name={b.name} size={18} />
              {b.name} · {b.role}
            </button>
          ))}
        </div>
      </Field>
      <Field label="发言方式">
        <div className="flex gap-1.5">
          <button
            onClick={() => setParallel(false)}
            className={cx('flex-1 rounded-lg border px-3 py-2 text-left text-xs transition', !parallel ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
          >
            <div className="font-medium">顺序讨论</div>
            <div className="mt-0.5 text-[10px] opacity-80">你一言我一语，后者能看到前者发言（更像真会议）</div>
          </button>
          <button
            onClick={() => setParallel(true)}
            className={cx('flex-1 rounded-lg border px-3 py-2 text-left text-xs transition', parallel ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
          >
            <div className="font-medium">并行发言</div>
            <div className="mt-0.5 text-[10px] opacity-80">全员同时发言，各自独立出观点（快 N 倍，互不可见）</div>
          </button>
        </div>
      </Field>
      <Field label="讨论轮数">
        <div className="flex gap-1.5">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setRounds(n)}
              className={cx('flex-1 rounded-lg border py-2 text-sm font-medium transition', rounds === n ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 text-slate-500')}
            >
              {n} 轮
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {rounds === 1 ? '各自表态一次即整理。' : `第 1 轮各自发言，之后 ${rounds - 1} 轮能看到他人发言、相互反应/收敛/抛分歧。`}
          {parallel && rounds >= 2 && <span className="text-brand"> 并行+多轮：兼顾速度与交锋，推荐。</span>}
        </p>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button
          onClick={() => {
            if (!title.trim() || picked.length === 0) return
            const id = createMeeting({ title: title.trim(), agenda: agenda.trim(), kind, productId, participantBotIds: picked, references: references.trim(), fullDocSlugs: fullDocs, parallel, rounds })
            toast('会议已创建')
            onCreated(id)
          }}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          创建
        </button>
      </div>
    </Modal>
  )
}

// ── 据会议执行计划生成任务 ───────────────────────────────
function GenTasksModal({ meeting, products, defaultProductId, onClose }: { meeting: Meeting; products: Product[]; defaultProductId: string | null; onClose: () => void }) {
  const addTask = useStore((s) => s.addTask)
  const items = useMemo(() => parseMeetingPlan(meeting.output), [meeting.output])
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => true))
  const [productId, setProductId] = useState<string | null>(defaultProductId)
  const n = checked.filter(Boolean).length

  function create() {
    let count = 0
    items.forEach((it, i) => {
      if (!checked[i]) return
      addTask({
        title: it.title,
        description: '',
        priority: 'medium',
        requirementId: null,
        kind: 'work',
        productId,
        brief: `${it.detail}\n\n（来源：会议「${meeting.title}」）`,
      })
      count++
    })
    toast(`已生成 ${count} 个任务到看板`)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="据会议执行计划生成任务">
      {items.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">未能从会议输出的「执行计划」里解析出任务项。可手动到看板新建。</p>
      ) : (
        <>
          <Field label="归属产品">
            <select className={inputCls} value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
              <option value="">（不指定产品）</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">选择要生成的任务 · {n}/{items.length}</div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {items.map((it, i) => (
              <label key={i} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={checked[i]} onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))} className="mt-1 accent-brand" />
                <span>{it.title}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        {items.length > 0 && (
          <button
            onClick={create}
            disabled={n === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            生成 {n} 个任务
          </button>
        )}
      </div>
    </Modal>
  )
}

// ── 会议纪要存为产品文档 ─────────────────────────────────
function SaveDocModal({ meeting, products, defaultProductId, ownerBotId, onClose }: { meeting: Meeting; products: Product[]; defaultProductId: string | null; ownerBotId: string | null; onClose: () => void }) {
  const addDoc = useStore((s) => s.addDoc)
  const openDoc = useStore((s) => s.openDoc)
  const [productId, setProductId] = useState<string | null>(defaultProductId)
  const [title, setTitle] = useState(`${meeting.title} · 会议纪要`)
  const [type, setType] = useState<DocType>('adr')
  const product = products.find((p) => p.id === productId)

  function save() {
    if (!productId || !product) {
      toast('请先选择归属产品', 'warn')
      return
    }
    const slug = `mtg-${Math.random().toString(36).slice(2, 10)}`
    addDoc({
      slug,
      title: title.trim() || `${meeting.title} · 会议纪要`,
      type,
      productId,
      productVersion: product.currentVersion,
      requirementId: null,
      ownerBotId,
      content: meeting.output,
    })
    toast('已存为产品文档')
    onClose()
    openDoc(productId, slug)
  }

  return (
    <Modal open onClose={onClose} title="会议纪要存为产品文档">
      <Field label="归属产品">
        <select className={inputCls} value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)}>
          <option value="">选择产品…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.currentVersion}）
            </option>
          ))}
        </select>
      </Field>
      <Field label="文档标题">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="文档类型">
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as DocType)}>
          {DOC_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE[t].label}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-[11px] text-slate-400">将以会议输出（执行计划 + 纪要）为正文，在产品文档中心创建一篇 v1 文档，之后可走版本流迭代。</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          存为文档
        </button>
      </div>
    </Modal>
  )
}

// ── 会议室 ───────────────────────────────────────────────
function MeetingRoom({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const meeting = useStore((s) => s.meetings.find((m) => m.id === meetingId))
  const bots = useStore((s) => s.bots)
  const products = useStore((s) => s.products)
  const projects = useStore((s) => s.projects)
  const allRequirements = useStore((s) => s.requirements)
  const allDocs = useStore((s) => s.docs)
  const allTasks = useStore((s) => s.tasks)
  const token = useAuth((s) => s.token)
  const addMeetingMessage = useStore((s) => s.addMeetingMessage)
  const setMeetingStatus = useStore((s) => s.setMeetingStatus)
  const mergeMeeting = useStore((s) => s.mergeMeeting)
  const setMeetingReferences = useStore((s) => s.setMeetingReferences)

  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [saveDocOpen, setSaveDocOpen] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)

  if (!meeting) return null
  const product = meeting.productId ? products.find((p) => p.id === meeting.productId) ?? null : null
  const participants = meeting.participantBotIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b)
  const pm = participants.find((b) => b.role === '产品经理') || bots.find((b) => b.role === '产品经理' && b.orgId === meeting.orgId) || participants[0]

  // 运行态派生（云端编排，进度靠轮询）：当前轮、是否在整理阶段
  const isRunning = meeting.status === 'running'
  const totalTurns = participants.length * Math.max(1, meeting.rounds ?? 1)
  const curRound = isRunning ? Math.min(Math.max(1, meeting.rounds ?? 1), Math.floor(meeting.messages.length / Math.max(1, participants.length)) + 1) : 0
  const consolidating = isRunning && meeting.messages.length >= totalTurns && !meeting.output

  // 项目级知识库：覆盖项目下全部产品，作为会议完整背景（聚焦选中产品）
  const project = projects.find((p) => p.id === meeting.projectId)
  const projectProducts = products.filter((p) => p.projectId === meeting.projectId)
  const projectProductIds = new Set(projectProducts.map((p) => p.id))
  const knowledge = buildProjectKnowledge({
    projectName: project?.name ?? '（未知项目）',
    projectDesc: project?.description ?? '',
    products: projectProducts,
    requirements: allRequirements.filter((r) => r.productId && projectProductIds.has(r.productId)),
    docs: allDocs.filter((d) => projectProductIds.has(d.productId)),
    tasks: allTasks.filter((t) => t.productId && projectProductIds.has(t.productId)),
    focusProductId: meeting.productId,
    references: meeting.references ?? '',
    fullDocSlugs: meeting.fullDocSlugs ?? [],
    includeTaskOutputs: meeting.kind === 'docgen',
  })

  const cur = () => useStore.getState().meetings.find((m) => m.id === meetingId)!

  // 开始会议：把各角色 prompt 片段发给后端，由云端常驻编排（关页面不中断）；本地轮询看进度
  async function runMeeting() {
    if (busy || !token) return
    setBusy(true)
    try {
      const m = cur()
      const rounds = Math.max(1, m.rounds ?? 1)
      const turns = participants.map((bot) => ({
        botId: bot.id,
        name: bot.name,
        role: bot.role,
        avatarSeed: bot.avatarSeed,
        head: turnHead(bot, m, product, knowledge),
        tail: turnTail(bot),
      }))
      const payload = {
        meeting: m,
        rounds,
        parallel: !!m.parallel,
        kind: m.kind,
        turns,
        roundDirectives: Array.from({ length: rounds - 1 }, (_, i) => roundDirectiveText(i + 2)),
        pm: { head: pmHead(pm, m, product, knowledge, m.kind), tail: pmTail(m.kind) },
      }
      await authApi.runMeeting(token, meetingId, payload)
      setMeetingStatus(meetingId, 'running')
      mergeMeeting(meetingId, { messages: [], output: '' })
      toast('会议已在云端开始，后端编排中——关页面/刷新都不影响，进度会自动刷新', 'success')
    } catch (err) {
      toast('开会失败：' + (err as Error).message, 'warn')
    } finally {
      setBusy(false)
    }
  }

  // 会议进行中：WS 推送即时刷新 + 慢轮询兜底，把发言/输出/状态合并到本地（关页面重开也能续看）
  useEffect(() => {
    if (!token || meeting?.status !== 'running') return
    let alive = true
    const poll = async () => {
      try {
        const { meeting: cloud, running } = await authApi.getMeeting(token, meetingId)
        if (!alive) return
        mergeMeeting(meetingId, cloud as Partial<Meeting>)
        if (!running && (cloud as { status?: string }).status === 'done') {
          toast((cloud as { kind?: string }).kind === 'docgen' ? '会议结束，已拟好《文档清单》' : '会议结束，已整理执行计划与纪要', 'success')
        }
      } catch {
        /* 下轮再试 */
      }
    }
    poll()
    const off = onCloudChange((kind) => {
      if (kind === 'meetings') poll()
    })
    const id = setInterval(poll, 8000) // WS 为主，轮询兜底
    return () => {
      alive = false
      clearInterval(id)
      off()
    }
  }, [token, meeting?.status, meetingId, mergeMeeting])

  function sendUserMsg() {
    if (!draft.trim()) return
    addMeetingMessage(meetingId, { speakerType: 'user', speakerId: 'me', speakerName: '你（主持）', content: draft.trim() })
    setDraft('')
  }

  const outputHtml = useMemo(() => (meeting.output ? renderMarkdown(meeting.output, new Map()) : ''), [meeting.output])

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      {/* 头部 */}
      <header className="mb-4">
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
          <ArrowLeft size={13} /> 返回会议列表
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{meeting.title}</h1>
              <span className={cx('rounded px-2 py-0.5 text-[11px] font-medium', KIND_CLS[meeting.kind])}>{MEETING_KIND[meeting.kind].label}</span>
              {meeting.status === 'done' && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">已结束</span>}
              {meeting.status === 'running' && <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">进行中</span>}
            </div>
            {meeting.agenda && <p className="mt-1 max-w-2xl text-sm text-slate-500">{meeting.agenda}</p>}
            <p className="mt-1.5 text-[11px] text-slate-400">
              背景知识库：
              <span className="text-slate-500">
                项目「{project?.name ?? '—'}」· {projectProducts.length} 产品 ·{' '}
                {allRequirements.filter((r) => r.productId && projectProductIds.has(r.productId)).length} 需求 ·{' '}
                {allDocs.filter((d) => projectProductIds.has(d.productId)).length} 文档
              </span>
              {product && <span className="text-brand"> · 聚焦「{product.name}」</span>}
              {(meeting.fullDocSlugs?.length ?? 0) > 0 && <span className="text-emerald-600"> · {meeting.fullDocSlugs.length} 篇全文</span>}
              {meeting.references?.trim() && <span className="text-emerald-600"> · 含补充资料</span>}
              <span className="text-slate-500"> · {meeting.parallel ? '并行' : '顺序'} · {meeting.rounds ?? 1} 轮</span>
            </p>
            {meeting.status === 'draft' && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium text-brand">补充背景资料 {meeting.references?.trim() ? '（已填）' : ''}</summary>
                <textarea
                  value={meeting.references ?? ''}
                  onChange={(e) => setMeetingReferences(meeting.id, e.target.value)}
                  placeholder="额外背景/约束/外部资料，会注入到讨论中"
                  className="mt-1.5 h-20 w-full max-w-2xl resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand"
                />
              </details>
            )}
          </div>
          {meeting.status === 'draft' && (
            <button
              onClick={runMeeting}
              disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} 开始会议
            </button>
          )}
        </div>
        {/* 参会者 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">参会：</span>
          {participants.map((b) => {
            const active = isRunning
            return (
              <span
                key={b.id}
                className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1', active ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'bg-white text-slate-600 ring-slate-200')}
              >
                <Avatar seed={b.avatarSeed} name={b.name} size={16} />
                {b.name}
                {active && <Loader2 size={10} className="animate-spin" />}
              </span>
            )
          })}
          {meeting.parallel && <span className="text-[10px] text-slate-400">· 并行发言</span>}
          {isRunning && (meeting.rounds ?? 1) > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">第 {curRound}/{meeting.rounds} 轮</span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">你（主持）</span>
        </div>
      </header>

      {/* 群聊记录 */}
      <div className="max-h-[55vh] min-h-[240px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
        {meeting.messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">
            {meeting.status === 'draft' ? `点「开始会议」，各虚拟人力将在 CLI plan 模式下${meeting.parallel ? '并行' : '依次'}发言${(meeting.rounds ?? 1) > 1 ? ` · 共 ${meeting.rounds} 轮` : ''}，产品经理会后整理。` : '会议进行中…'}
          </div>
        )}
        {meeting.messages.map((m, i) => {
          const prev = meeting.messages[i - 1]
          const showRoundDivider = (meeting.rounds ?? 1) > 1 && !!m.round && m.speakerType === 'bot' && (!prev || prev.round !== m.round)
          return (
          <Fragment key={m.id}>
          {showRoundDivider && (
            <div className="flex items-center gap-2 py-1 text-[11px] font-medium text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              第 {m.round} 轮讨论{m.round! >= 2 ? '（相互反应 / 收敛 / 抛分歧）' : ''}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          )}
          <div className={cx('flex gap-2.5', m.speakerType === 'user' && 'flex-row-reverse')}>
            {m.speakerType === 'user' ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">你</div>
            ) : (
              <Avatar seed={m.avatarSeed ?? m.speakerId} name={m.speakerName} size={32} />
            )}
            <div className={cx('max-w-[80%] rounded-2xl px-3.5 py-2.5', m.speakerType === 'user' ? 'bg-emerald-500 text-white' : 'bg-white ring-1 ring-slate-200')}>
              <div className={cx('mb-1 flex items-center gap-1.5 text-[11px]', m.speakerType === 'user' ? 'text-emerald-50' : 'text-slate-400')}>
                <span className="font-semibold">{m.speakerName}</span>
                {m.speakerRole && <span>· {m.speakerRole}</span>}
                {m.speakerType === 'bot' && <span className="rounded bg-slate-100 px-1 text-[9px] text-slate-500">plan</span>}
              </div>
              <div className={cx('whitespace-pre-wrap text-sm leading-relaxed', m.speakerType === 'user' ? 'text-white' : 'text-slate-700')}>
                {m.content || <span className="text-slate-300">…</span>}
              </div>
            </div>
          </div>
          </Fragment>
          )
        })}
        {consolidating && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-400">
            <Loader2 size={13} className="animate-spin" /> 产品经理 {pm?.name} 正在整理会议输出…
          </div>
        )}
      </div>

      {/* 发言输入（可随时补充背景/意见）*/}
      {meeting.status !== 'running' && (
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendUserMsg()}
            placeholder="以主持人身份发言 / 补充背景（开始会议前发言会作为讨论背景）"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button onClick={sendUserMsg} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-600 hover:bg-slate-200">
            <Send size={14} /> 发言
          </button>
        </div>
      )}

      {/* 产品经理输出：执行计划 + 会议纪要 */}
      {(meeting.output || consolidating) && (
        <div className="mt-4 rounded-2xl border border-brand/30 bg-brand-soft/40 p-5">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-brand">
            <ClipboardList size={15} /> {meeting.kind === 'docgen' ? '文档清单' : '会议输出'} · 由产品经理 {pm?.name} 整理
            {consolidating && <Loader2 size={13} className="animate-spin" />}
            {meeting.output && !consolidating && (
              <div className="ml-auto flex gap-1.5">
                {meeting.kind === 'docgen' ? (
                  <button
                    onClick={() => setAuthorOpen(true)}
                    className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    <FileText size={13} /> 据清单撰写文档
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setSaveDocOpen(true)}
                      className="flex items-center gap-1 rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-soft"
                    >
                      <FileText size={13} /> 存为文档
                    </button>
                    <button
                      onClick={() => setGenOpen(true)}
                      className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      <ListPlus size={13} /> 据此生成任务
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {meeting.output ? (
            <div
              className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-h2:text-base"
              dangerouslySetInnerHTML={{ __html: outputHtml }}
            />
          ) : (
            <p className="text-sm text-slate-400">整理中…</p>
          )}
        </div>
      )}

      {genOpen && <GenTasksModal meeting={meeting} products={projectProducts} defaultProductId={meeting.productId ?? projectProducts[0]?.id ?? null} onClose={() => setGenOpen(false)} />}
      {saveDocOpen && (
        <SaveDocModal meeting={meeting} products={projectProducts} defaultProductId={meeting.productId ?? projectProducts[0]?.id ?? null} ownerBotId={pm?.id ?? null} onClose={() => setSaveDocOpen(false)} />
      )}
      {authorOpen && (
        <AuthorDocsModal
          meeting={meeting}
          products={projectProducts}
          orgBots={bots.filter((b) => b.orgId === meeting.orgId)}
          knowledge={knowledge}
          defaultProductId={meeting.productId ?? projectProducts[0]?.id ?? null}
          onClose={() => setAuthorOpen(false)}
        />
      )}
    </div>
  )
}

// ── 文档撰写会：据《文档清单》逐篇让负责角色撰写完整文档，存入文档中心 ──
function AuthorDocsModal({
  meeting,
  products,
  orgBots,
  knowledge,
  defaultProductId,
  onClose,
}: {
  meeting: Meeting
  products: Product[]
  orgBots: Bot[]
  knowledge: string
  defaultProductId: string | null
  onClose: () => void
}) {
  const allDocs = useStore((s) => s.docs)
  const openDoc = useStore((s) => s.openDoc)
  const token = useAuth((s) => s.token)
  const items = useMemo(() => parseDocManifest(meeting.output), [meeting.output])
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => true))
  const [productId, setProductId] = useState<string | null>(defaultProductId)
  const [running, setRunning] = useState(false)
  const [created, setCreated] = useState<{ slug: string; title: string }[]>([])

  const product = products.find((p) => p.id === productId)
  const n = checked.filter(Boolean).length
  const resolveBot = (role: string): Bot | undefined =>
    orgBots.find((b) => b.role === role) || orgBots.find((b) => b.role === '产品经理') || orgBots[0]

  // 入队云端 job：每篇文档一个 doc_author job，后端撰写、产出落库；全局对账据 meta 建文档
  async function authorAll() {
    if (running || !token) return
    if (!productId || !product) {
      toast('请先选择归属产品', 'warn')
      return
    }
    const chosen = items.filter((_, i) => checked[i])
    if (chosen.length === 0) return
    setRunning(true)
    try {
      const jobs = chosen.map((item) => {
        const bot = resolveBot(item.ownerRole)
        const slug = `doc-${Math.random().toString(36).slice(2, 10)}`
        return {
          kind: 'doc_author',
          refType: 'doc',
          refId: slug,
          title: item.title,
          prompt: docAuthorPrompt(bot ?? orgBots[0], meeting, product, knowledge, item),
          meta: { slug, title: item.title, type: item.type, productId, productVersion: product.currentVersion, ownerBotId: bot?.id ?? null },
        }
      })
      await authApi.enqueueJobs(token, jobs)
      setCreated(jobs.map((j) => ({ slug: j.refId, title: j.title })))
      toast(`已入队 ${jobs.length} 篇文档到云端撰写——关页面也不影响，写好自动进文档中心`, 'success')
    } catch (err) {
      toast('入队失败：' + (err as Error).message, 'warn')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="据《文档清单》撰写项目文档">
      {items.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">未能从会议输出里解析出文档清单。请确认这是「文档撰写」会议，且产品经理已按格式产出清单。</p>
      ) : (
        <>
          <Field label="归属产品">
            <select className={inputCls} value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)} disabled={running}>
              <option value="">选择产品…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.currentVersion}）
                </option>
              ))}
            </select>
          </Field>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">要撰写的文档 · {n}/{items.length}</div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {items.map((it, i) => {
              const bot = resolveBot(it.ownerRole)
              const enq = created.find((c) => c.title === it.title)
              const madeDoc = enq && allDocs.find((d) => d.slug === enq.slug)
              return (
                <label key={i} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    disabled={running || !!enq}
                    onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                    className="mt-1 accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{it.title}</span>
                    <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{DOC_TYPE[it.type]?.label ?? it.type}</span>
                    <span className="ml-1 text-[11px] text-slate-400">· {bot?.name ?? '?'}（{it.ownerRole}）</span>
                    {madeDoc ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          onClose()
                          if (productId) openDoc(productId, enq!.slug)
                        }}
                        className="ml-1.5 text-[11px] font-medium text-emerald-600 hover:underline"
                      >
                        ✓ 已写成，查看
                      </button>
                    ) : enq ? (
                      <span className="ml-1.5 text-[11px] text-brand">云端撰写中…</span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">每篇入队云端由对应角色撰写——关页面也不影响，写好自动进文档中心。</p>
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={running} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          {created.length ? '完成' : '取消'}
        </button>
        {items.length > 0 && created.length === 0 && (
          <button
            onClick={authorAll}
            disabled={running || n === 0 || !productId}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            {running ? '入队中…' : `撰写 ${n} 篇`}
          </button>
        )}
      </div>
    </Modal>
  )
}

// ── 会议列表 / 入口 ──────────────────────────────────────
export function Meetings() {
  const allBots = useStore((s) => s.bots)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const allProducts = useStore((s) => s.products)
  const meetings = useStore((s) => s.meetings)
  const removeMeeting = useStore((s) => s.removeMeeting)

  const orgBots = allBots.filter((b) => b.orgId === currentOrgId && b.status !== 'offline')
  const products = allProducts.filter((p) => p.projectId === currentProjectId)
  const projectMeetings = meetings.filter((m) => m.projectId === currentProjectId || (!m.projectId && m.orgId === currentOrgId))

  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  if (openId && projectMeetings.some((m) => m.id === openId)) {
    return <MeetingRoom meetingId={openId} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-7">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">会议</h1>
          <p className="mt-1 text-sm text-slate-500">虚拟人力（CLI plan 模式）+ 你，为立项/变更群聊讨论，产品经理会后整理出执行计划与纪要。</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> 发起会议
        </button>
      </header>

      {projectMeetings.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Users size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">还没有会议。点「发起会议」，召集虚拟人力开一次立项/变更会。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projectMeetings.map((m) => (
            <MeetingListItem key={m.id} meeting={m} onOpen={() => setOpenId(m.id)} onRemove={() => removeMeeting(m.id)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateMeeting
          orgBots={orgBots}
          products={products}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setOpenId(id)
          }}
        />
      )}
    </div>
  )
}

function MeetingListItem({ meeting, onOpen, onRemove }: { meeting: Meeting; onOpen: () => void; onRemove: () => void }) {
  const bots = useStore((s) => s.bots)
  const participants = meeting.participantBotIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b)
  return (
    <div className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand/40 hover:shadow-sm">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Users size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{meeting.title}</span>
            <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_CLS[meeting.kind])}>{MEETING_KIND[meeting.kind].label}</span>
            {meeting.status === 'done' && <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">已结束</span>}
            {meeting.status === 'running' && <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">进行中</span>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><BotIcon size={12} /> {participants.length} 位参会</span>
            <span className="flex items-center gap-1"><FileText size={12} /> {meeting.messages.length} 条发言</span>
            {meeting.output && <span className="flex items-center gap-1 text-emerald-600"><Sparkles size={12} /> 已出计划</span>}
          </div>
        </div>
      </button>
      <button onClick={onRemove} title="删除会议" className="shrink-0 rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
        <Trash2 size={15} />
      </button>
    </div>
  )
}
