import { useMemo, useState } from 'react'
import { Users, Plus, Play, Loader2, Send, Sparkles, Trash2, FileText, ArrowLeft, Bot as BotIcon, ClipboardList } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi, runExecutorStream } from '../lib/authApi'
import { botTurnPrompt, pmConsolidatePrompt, buildProjectKnowledge, MEETING_KIND } from '../lib/meeting'
import { renderMarkdown } from '../lib/markdown'
import { Avatar, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { toast } from '../lib/toast'
import type { Bot, Meeting, MeetingKind, Product } from '../types'

const KIND_CLS: Record<MeetingKind, string> = {
  kickoff: 'bg-indigo-100 text-indigo-700',
  change: 'bg-amber-100 text-amber-700',
  standup: 'bg-slate-100 text-slate-600',
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
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
          取消
        </button>
        <button
          onClick={() => {
            if (!title.trim() || picked.length === 0) return
            const id = createMeeting({ title: title.trim(), agenda: agenda.trim(), kind, productId, participantBotIds: picked, references: references.trim(), fullDocSlugs: fullDocs })
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
  const appendMeetingMessage = useStore((s) => s.appendMeetingMessage)
  const setMeetingMessage = useStore((s) => s.setMeetingMessage)
  const setMeetingStatus = useStore((s) => s.setMeetingStatus)
  const setMeetingOutput = useStore((s) => s.setMeetingOutput)
  const setMeetingReferences = useStore((s) => s.setMeetingReferences)

  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [consolidating, setConsolidating] = useState(false)
  const [draft, setDraft] = useState('')

  if (!meeting) return null
  const product = meeting.productId ? products.find((p) => p.id === meeting.productId) ?? null : null
  const participants = meeting.participantBotIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b)
  const pm = participants.find((b) => b.role === '产品经理') || bots.find((b) => b.role === '产品经理' && b.orgId === meeting.orgId) || participants[0]

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
  })

  const cur = () => useStore.getState().meetings.find((m) => m.id === meetingId)!

  async function pickExecutor(): Promise<string | null> {
    if (!token) return null
    try {
      const { machines } = await authApi.machines(token)
      const online = machines.filter((m) => m.online).flatMap((m) => m.executors)
      return online.find((e) => e.status === 'idle')?.id || online[0]?.id || null
    } catch {
      return null
    }
  }

  async function runMeeting() {
    if (busy || !token) return
    const exec = await pickExecutor()
    if (!exec) {
      toast('没有在线的本地算力。去「团队与账户 → 本地算力」绑定电脑并保持 agent 运行。', 'warn')
      return
    }
    setBusy(true)
    setMeetingStatus(meetingId, 'running')
    try {
      // 每位虚拟人力依次发言（plan 模式）
      for (const bot of participants) {
        setSpeaking(bot.id)
        const msgId = addMeetingMessage(meetingId, {
          speakerType: 'bot',
          speakerId: bot.id,
          speakerName: bot.name,
          speakerRole: bot.role,
          avatarSeed: bot.avatarSeed,
          content: '',
        })
        const prior = cur().messages.filter((m) => m.id !== msgId)
        const prompt = botTurnPrompt(bot, cur(), prior, product, knowledge)
        try {
          await runExecutorStream(token, { executorId: exec, prompt, planMode: true }, (e) => {
            if (e.t === 'chunk') {
              if (!e.text.startsWith('[agent]')) appendMeetingMessage(meetingId, msgId, e.text)
            } else if (e.t === 'done' && e.result) setMeetingMessage(meetingId, msgId, e.result)
            else if (e.t === 'error') setMeetingMessage(meetingId, msgId, '⚠️ ' + e.error)
          })
        } catch (err) {
          setMeetingMessage(meetingId, msgId, '⚠️ ' + (err as Error).message)
        }
      }
      setSpeaking(null)
      // 产品经理会后整理
      setConsolidating(true)
      const pmPrompt = pmConsolidatePrompt(pm, cur(), cur().messages, product, knowledge)
      let out = ''
      await runExecutorStream(token, { executorId: exec, prompt: pmPrompt, planMode: true }, (e) => {
        if (e.t === 'chunk') {
          out += e.text
          setMeetingOutput(meetingId, out)
        } else if (e.t === 'done' && e.result) {
          out = e.result
          setMeetingOutput(meetingId, out)
        } else if (e.t === 'error') {
          out = (out + '\n⚠️ ' + e.error).trim()
          setMeetingOutput(meetingId, out)
        }
      })
      setMeetingStatus(meetingId, 'done')
      toast('会议结束，产品经理已整理出执行计划与纪要', 'success')
    } finally {
      setBusy(false)
      setSpeaking(null)
      setConsolidating(false)
    }
  }

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
          {participants.map((b) => (
            <span
              key={b.id}
              className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1', speaking === b.id ? 'bg-indigo-50 text-indigo-700 ring-indigo-300' : 'bg-white text-slate-600 ring-slate-200')}
            >
              <Avatar seed={b.avatarSeed} name={b.name} size={16} />
              {b.name}
              {speaking === b.id && <Loader2 size={10} className="animate-spin" />}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">你（主持）</span>
        </div>
      </header>

      {/* 群聊记录 */}
      <div className="max-h-[55vh] min-h-[240px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
        {meeting.messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">
            {meeting.status === 'draft' ? '点「开始会议」，各虚拟人力将在 CLI plan 模式下依次发言，产品经理会后整理。' : '会议进行中…'}
          </div>
        )}
        {meeting.messages.map((m) => (
          <div key={m.id} className={cx('flex gap-2.5', m.speakerType === 'user' && 'flex-row-reverse')}>
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
        ))}
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
            <ClipboardList size={15} /> 会议输出 · 由产品经理 {pm?.name} 整理
            {consolidating && <Loader2 size={13} className="animate-spin" />}
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
    </div>
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
