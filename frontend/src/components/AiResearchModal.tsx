import { useEffect, useMemo, useState } from 'react'
import { Search, Loader2, Globe, FileText, Copy, Check, Square } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi, runExecutorStream, type LiveMachine } from '../lib/authApi'
import { renderMarkdown } from '../lib/markdown'
import { Modal } from './Modal'
import { toast } from '../lib/toast'

// 联网调研提示词：强制用真实来源，禁止编造，产出结构化带链接报告
function researchPrompt(question: string, projectCtx: string): string {
  return [
    '你是一名严谨的市场调研分析师。请针对下面的调研问题，**使用你的联网搜索工具（WebSearch / WebFetch）查找真实、尽量最新的公开信息**，产出一份有据可查的调研报告。',
    '',
    '# 调研问题',
    question.trim(),
    projectCtx ? `\n# 项目背景（帮助你聚焦，不是调研对象）\n${projectCtx}` : '',
    '',
    '# 硬性要求（务必遵守）',
    '1. **必须给出真实的公司名、产品名**。每个竞品/参考产品至少：名称 + 一句定位 + 官网或来源链接。',
    '2. 涉及价格 / 市场规模 / 份额 / 融资等数字，**必须标注来源链接与日期**；没有可靠来源就写「未找到公开数据」，**绝对不要编造数字、公司或链接**。',
    '3. 分清「事实（有来源）」与「推断（你的判断）」，推断处显式标注「(推断)」。',
    '4. 查不到就如实说查不到，宁缺毋滥；不要用泛泛而谈填充。',
    '',
    '# 报告结构（Markdown 输出）',
    '## 调研摘要（3–5 条关键发现）',
    '## 竞品 / 参考产品（表格：产品 | 公司 | 定位 | 定价(如有) | 来源链接）',
    '## 市场与需求（规模 / 趋势 / 付费方，每条带来源）',
    '## 空白点与机会（结合项目背景）',
    '## 结论与建议',
    '## 参考来源（编号链接清单）',
    '',
    '现在开始联网调研，然后直接输出报告（不要先问我问题）。',
  ].join('\n')
}

export function AiResearchModal({ onClose }: { onClose: () => void }) {
  const token = useAuth((s) => s.token)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const currentProject = useStore((s) => s.projects.find((p) => p.id === currentProjectId))
  const allProducts = useStore((s) => s.products)
  const addDoc = useStore((s) => s.addDoc)
  const openDoc = useStore((s) => s.openDoc)
  const projectProducts = allProducts.filter((p) => p.projectId === currentProjectId)

  const [question, setQuestion] = useState('')
  const [productId, setProductId] = useState<string>(projectProducts[0]?.id ?? '')
  const [phase, setPhase] = useState<'input' | 'running' | 'done'>('input')
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const stopRef = useState<{ stop: boolean }>({ stop: false })[0]

  const [machines, setMachines] = useState<LiveMachine[]>([])
  useEffect(() => {
    if (!token) return
    let alive = true
    const load = () => authApi.machines(token).then((r) => alive && setMachines(r.machines)).catch(() => {})
    load()
    const id = setInterval(load, 6000)
    return () => { alive = false; clearInterval(id) }
  }, [token])
  const execId =
    machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors).find((e) => e.kind === 'claude' && e.status === 'idle')?.id ||
    machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors).find((e) => e.kind === 'claude')?.id ||
    ''

  const html = useMemo(() => (output ? renderMarkdown(output, new Map()) : ''), [output])

  async function run() {
    if (!token || !question.trim()) { toast('先写下要调研什么', 'warn'); return }
    if (!execId) { toast('需要一台在线执行器来联网调研（团队与账户 → 本地算力）', 'warn'); return }
    setPhase('running'); setOutput(''); stopRef.stop = false
    const ctx = currentProject ? `项目「${currentProject.name}」${currentProject.description ? '：' + currentProject.description : ''}` : ''
    try {
      await runExecutorStream(token, { executorId: execId, prompt: researchPrompt(question.trim(), ctx) }, (e) => {
        if (stopRef.stop) return
        if (e.t === 'chunk' && !e.text.startsWith('[agent]')) setOutput((o) => o + e.text)
        else if (e.t === 'done') { if (e.result) setOutput(e.result); setPhase('done') }
        else if (e.t === 'error') { setOutput((o) => o + `\n\n> ✗ ${e.error}`); setPhase('done') }
      })
      setPhase('done')
    } catch (err) {
      setOutput((o) => o + `\n\n> ✗ ${(err as Error).message}`); setPhase('done')
    }
  }

  function saveDoc() {
    const product = projectProducts.find((p) => p.id === productId)
    if (!product) { toast('先建一个产品，才能把调研存为文档', 'warn'); return }
    const slug = 'research-' + Math.random().toString(36).slice(2, 8)
    const title = ('调研 · ' + question.trim()).slice(0, 60)
    addDoc({ slug, title, type: 'research', productId: product.id, productVersion: product.currentVersion, requirementId: null, ownerBotId: null, content: output })
    toast('已存为调研文档', 'success')
    openDoc(product.id, slug)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="AI 调研 · 联网找真实信息" wide>
      {phase === 'input' ? (
        <>
          <p className="mb-2 text-[13px] text-slate-500">
            输入要调研什么，AI 会<b>真联网搜索</b>，产出<b>带真实公司/产品/定价/来源链接</b>的报告 —— 查不到会如实说明，不编造。
          </p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="例：面向短剧/影视团队的 AI 影视制作与资产管理平台，市面上有哪些竞品和参考产品？各自定位、定价、面向谁？空白点在哪？"
            className="h-36 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-500">
            <Globe size={13} className="text-brand" /> 会用 WebSearch 联网
            {!execId && <span className="text-amber-600">· 需在线执行器</span>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
            <button onClick={run} disabled={!question.trim() || !execId} className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              <Search size={15} /> 开始联网调研
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 text-[13px]">
            {phase === 'running' ? <Loader2 size={15} className="animate-spin text-brand" /> : <Check size={15} className="text-emerald-500" />}
            <span className="text-slate-600">{phase === 'running' ? '联网调研中…（可能 1–4 分钟，会边搜边写）' : '调研完成'}</span>
            {phase === 'running' && (
              <button onClick={() => { stopRef.stop = true; setPhase('done') }} className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-200">
                <Square size={12} /> 停止
              </button>
            )}
          </div>
          <div className="max-h-[56vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
            {output ? (
              <div className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-a:text-brand prose-table:text-sm" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="text-sm text-slate-400">正在启动调研 agent…</p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button onClick={() => { setPhase('input'); setOutput('') }} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">重新调研</button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { navigator.clipboard?.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                disabled={!output}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已复制' : '复制'}
              </button>
              {projectProducts.length > 1 && (
                <select value={productId} onChange={(e) => setProductId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-600 outline-none focus:border-brand">
                  {projectProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <button
                onClick={saveDoc}
                disabled={!output || phase === 'running' || projectProducts.length === 0}
                title={projectProducts.length === 0 ? '当前项目还没有产品，无法存为文档' : '存为产品文档（调研）'}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <FileText size={15} /> 存为调研文档
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
