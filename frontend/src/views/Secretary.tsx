import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, FileText, CheckCircle2, ListTodo, Rocket, AlertTriangle } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useStore } from '../store/useStore'
import { authApi } from '../lib/authApi'
import { toast } from '../lib/toast'
import type { DocType, Priority } from '../types'

type Msg = { id: string; role: string; content: string; created_at: number }

const DOC_TYPES: DocType[] = ['vision', 'prd', 'story', 'arch', 'api', 'data', 'design', 'adr', 'test', 'release']
type DocProposal = { title: string; type: DocType; product: string; content: string }
type Action =
  | { kind: 'backlog_add'; project: string; product: string; title: string; brief: string; priority: string }
  | { kind: 'autopilot_run'; project: string; goal: string; feedback: string }

const field = (body: string, k: string) => (body.match(new RegExp(`${k}\\s*[:：]\\s*(.+)`))?.[1] || '').trim()
const normPrio = (s: string) => (/high|高/.test(s) ? 'high' : /low|低/.test(s) ? 'low' : 'medium')

// 从秘书回复里解析文档草案块 + 调度动作块，返回剥离标记后的对话正文(拆简短版/详细版) + 草案 + 动作列表
function parseSecretary(text: string): { before: string; detail: string; doc: DocProposal | null; actions: Action[] } {
  let doc: DocProposal | null = null
  const dm = text.match(/===DOC===([\s\S]*?)===CONTENT===\s*\n?([\s\S]*?)\n?===END===/)
  if (dm) {
    const rawType = field(dm[1], 'TYPE').toLowerCase()
    doc = { title: field(dm[1], 'TITLE') || '未命名文档', type: (DOC_TYPES.includes(rawType as DocType) ? rawType : 'prd') as DocType, product: field(dm[1], 'PRODUCT'), content: dm[2].trim() }
  }
  const actions: Action[] = []
  const re = /===ACTION===([\s\S]*?)===END_ACTION===/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const b = m[1]
    const kind = field(b, 'KIND').toLowerCase()
    if (kind === 'backlog_add') actions.push({ kind: 'backlog_add', project: field(b, 'PROJECT'), product: field(b, 'PRODUCT'), title: field(b, 'TITLE'), brief: field(b, 'BRIEF'), priority: normPrio(field(b, 'PRIORITY')) })
    else if (kind === 'autopilot_run') actions.push({ kind: 'autopilot_run', project: field(b, 'PROJECT'), goal: field(b, 'GOAL'), feedback: field(b, 'FEEDBACK') })
  }
  const stripped = text.replace(/===DOC===[\s\S]*?===END===/g, '').replace(/===ACTION===[\s\S]*?===END_ACTION===/g, '').trim()
  // 两段式：===DETAIL=== 之前是简短口头版，之后是详细版（前端折叠）
  const di = stripped.search(/^\s*===DETAIL===\s*$/m)
  const before = di >= 0 ? stripped.slice(0, di).trim() : stripped
  const detail = di >= 0 ? stripped.slice(di).replace(/^\s*===DETAIL===\s*$/m, '').trim() : ''
  return { before, detail, doc, actions }
}

// 文档草案卡：选目标产品 → 确认写入「产品文档」。slug 用消息 id 保证幂等（重开转录不重复写）
function DocCard({ msgId, doc }: { msgId: string; doc: DocProposal }) {
  const products = useStore((s) => s.products)
  const docs = useStore((s) => s.docs)
  const addDoc = useStore((s) => s.addDoc)
  const slug = `doc-sec-${msgId}`
  const existing = docs.find((d) => d.slug === slug)
  const [pid, setPid] = useState(() => products.find((p) => p.name === doc.product)?.id ?? products[0]?.id ?? '')
  const [open, setOpen] = useState(false)

  function write() {
    const prod = products.find((p) => p.id === pid)
    if (!prod) { toast('请选择目标产品', 'warn'); return }
    addDoc({ slug, title: doc.title, type: doc.type, productId: prod.id, productVersion: prod.currentVersion || 'v1.0.0', requirementId: null, ownerBotId: null, content: doc.content })
    toast(`已写入《${doc.title}》到「${prod.name}」`, 'success')
  }

  return (
    <div className="mt-1.5 max-w-[85%] rounded-2xl rounded-bl-sm border border-brand/30 bg-brand-soft/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
        <FileText size={13} /> 文档草案 · {doc.title}
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{doc.type}</span>
      </div>
      <button onClick={() => setOpen((v) => !v)} className="mb-2 text-[11px] text-slate-500 underline-offset-2 hover:underline">{open ? '收起正文' : '预览正文'}</button>
      {open && <pre className="mb-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed text-slate-600">{doc.content}</pre>}
      {existing ? (
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700"><CheckCircle2 size={14} /> 已写入产品文档</div>
      ) : products.length === 0 ? (
        <p className="text-[11px] text-slate-400">当前公司还没有产品/模块，无法写入。先在项目下建一个产品。</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">写入到</span>
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] outline-none">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={write} className="rounded-lg bg-brand px-3 py-1 text-[12px] font-medium text-white hover:bg-indigo-700">确认写入</button>
        </div>
      )}
    </div>
  )
}

const SUGGESTIONS = [
  '各项目现在整体什么进度？',
  '哪个项目最需要我关注？为什么',
  '帮我把一个想法整理成文档要点',
]

// 调度动作卡 · 加 backlog 待办：选目标产品 → 确认加入。同标题+同产品已存在则视为已加入（幂等）
function BacklogAddCard({ a }: { a: Extract<Action, { kind: 'backlog_add' }> }) {
  const products = useStore((s) => s.products)
  const tasks = useStore((s) => s.tasks)
  const addTask = useStore((s) => s.addTask)
  const [pid, setPid] = useState(() => products.find((p) => p.name === a.product)?.id ?? products[0]?.id ?? '')
  const [added, setAdded] = useState(false)
  const exists = added || tasks.some((t) => t.title === a.title && t.productId === pid)
  const dot = a.priority === 'high' ? 'bg-rose-500' : a.priority === 'low' ? 'bg-slate-300' : 'bg-amber-400'
  function add() {
    const prod = products.find((p) => p.id === pid)
    if (!prod) { toast('请选择目标产品', 'warn'); return }
    addTask({ title: a.title, description: '', priority: a.priority as Priority, requirementId: null, kind: 'work', productId: pid, brief: a.brief })
    setAdded(true); toast(`已加入「${prod.name}」的 backlog`, 'success')
  }
  return (
    <div className="mt-1.5 max-w-[85%] rounded-2xl rounded-bl-sm border border-amber-300/60 bg-amber-50/50 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
        <ListTodo size={13} /> 待办 · {a.title}
        <span className={'ml-0.5 inline-block h-1.5 w-1.5 rounded-full ' + dot} />
      </div>
      {a.brief && <p className="mb-2 text-[11px] text-slate-600">{a.brief}</p>}
      {exists ? (
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700"><CheckCircle2 size={14} /> 已加入 backlog</div>
      ) : products.length === 0 ? (
        <p className="text-[11px] text-slate-400">当前公司还没有产品/模块，无法加入。</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">写入到</span>
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] outline-none">
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={add} className="rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-amber-600">加入 backlog</button>
        </div>
      )}
    </div>
  )
}

// 调度动作卡 · 跑自驾一轮：确认后 POST /autopilot/run。项目须已接工作区
function AutopilotRunCard({ a }: { a: Extract<Action, { kind: 'autopilot_run' }> }) {
  const project = useStore((s) => s.projects.find((p) => p.name === a.project))
  const token = useAuth((s) => s.token)
  const [done, setDone] = useState(false)
  const hasWs = !!project?.workspace?.repoPath
  async function run() {
    if (!project || !token) return
    try {
      await authApi.runAutopilot(token, { projectId: project.id, goal: a.goal, feedback: a.feedback || undefined })
      setDone(true); toast('已启动自驾一轮，去「发布」看进度', 'success')
    } catch (e) { toast('启动失败：' + (e as Error).message, 'warn') }
  }
  return (
    <div className="mt-1.5 max-w-[85%] rounded-2xl rounded-bl-sm border border-brand/30 bg-brand-soft/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-brand"><Rocket size={13} /> 自驾一轮 · {a.project}</div>
      <p className="text-[11px] text-slate-600">目标：{a.goal}</p>
      {a.feedback && <p className="mt-0.5 text-[11px] text-slate-500">提示：{a.feedback}</p>}
      <div className="mt-2">
        {done ? (
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700"><CheckCircle2 size={14} /> 已启动，去「发布」看进度</div>
        ) : !project ? (
          <div className="flex items-center gap-1.5 text-[12px] text-rose-600"><AlertTriangle size={14} /> 找不到项目「{a.project}」</div>
        ) : !hasWs ? (
          <div className="flex items-center gap-1.5 text-[12px] text-amber-600"><AlertTriangle size={14} /> 该项目未接工作区，无法自驾（先去团队与账户配 repo）</div>
        ) : (
          <button onClick={run} className="rounded-lg bg-brand px-3 py-1 text-[12px] font-medium text-white hover:bg-indigo-700">开跑自驾一轮</button>
        )}
      </div>
    </div>
  )
}

// 一条秘书消息：简短口头版 + 可展开的详细版 + 文档草案卡 + 调度动作卡
function AssistantMessage({ m }: { m: Msg }) {
  const { before, detail, doc, actions } = parseSecretary(m.content)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-start">
      {before && <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-700">{before}</div>}
      {detail && (
        <>
          <button onClick={() => setOpen((v) => !v)} className="ml-1 mt-1 text-[11px] font-medium text-brand hover:underline">{open ? '收起详情' : '展开详情'}</button>
          {open && <div className="mt-1 max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-50 px-3.5 py-2 text-[13px] leading-relaxed text-slate-600 ring-1 ring-slate-200">{detail}</div>}
        </>
      )}
      {doc && <DocCard msgId={m.id} doc={doc} />}
      {actions.map((a, i) => (a.kind === 'backlog_add' ? <BacklogAddCard key={i} a={a} /> : <AutopilotRunCard key={i} a={a} />))}
    </div>
  )
}

export function Secretary() {
  const token = useAuth((s) => s.token)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    authApi.getSecretary(token).then((r) => { setMsgs(r.messages); setLoaded(true) }).catch(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(text?: string) {
    const message = (text ?? input).trim()
    if (!message || busy || !token) return
    setInput('')
    const optimistic: Msg = { id: 'local-' + Date.now(), role: 'user', content: message, created_at: Date.now() }
    setMsgs((m) => [...m, optimistic])
    setBusy(true)
    try {
      const { reply } = await authApi.secretaryChat(token, message)
      setMsgs((m) => [...m, { id: 'r-' + Date.now(), role: 'assistant', content: reply, created_at: Date.now() }])
    } catch (err) {
      setMsgs((m) => [...m, { id: 'e-' + Date.now(), role: 'assistant', content: '（出错：' + (err as Error).message + '）', created_at: Date.now() }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800"><Sparkles size={18} className="text-brand" /> 项目秘书</h1>
        <p className="mt-1 text-sm text-slate-500">拥有全局视野。问她任何项目的情况，或让她陪你把想法理成文档要点。（现阶段只读与讨论，写文档/调度将后续开放）</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white/60 p-4">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-sm text-slate-400">还没聊过。试试问：</div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 hover:border-brand/40 hover:text-brand">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-white">{m.content}</div>
                </div>
              )
            }
            return <AssistantMessage key={m.id} m={m} />
          })
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> 秘书在看资料…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="问秘书任何事，或说出你的想法…（Enter 发送，Shift+Enter 换行）"
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-indigo-700 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
