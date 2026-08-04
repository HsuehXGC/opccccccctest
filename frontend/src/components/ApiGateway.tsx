import { useEffect, useState } from 'react'
import { KeyRound, Plus, Copy, Trash2, Loader2, ShieldAlert, Check, Terminal, BookOpen } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { authApi, type ApiKey } from '../lib/authApi'
import { renderMarkdown } from '../lib/markdown'
import { Modal } from './Modal'
import { cx } from '../lib/ui'
import { toast } from '../lib/toast'
import API_DOC from '../lib/apiDoc.md?raw'

const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : '—')

// 对外 API：把用户本地算力的 claude 暴露成 OpenAI 兼容接口，第三方凭 key 调用。
export function ApiGateway() {
  const token = useAuth((s) => s.token)!
  const base = `${window.location.origin}/v1`
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [agent, setAgent] = useState(false) // 代理模式（可用工具/执行命令）；默认受限
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null) // 刚生成的明文 secret（仅此一次）
  const [copied, setCopied] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [docOpen, setDocOpen] = useState(false)

  async function load() {
    try { setKeys((await authApi.apiKeys(token)).keys) } catch { /* 忽略 */ } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  async function create() {
    setCreating(true)
    try {
      const r = await authApi.createApiKey(token, name.trim(), agent)
      setFresh(r.secret)
      setName('')
      await load()
      toast('已生成 API Key，请立即复制保存', 'success')
    } catch (e) { toast((e as Error).message, 'warn') } finally { setCreating(false) }
  }
  async function revoke(id: string) {
    setRevoking(id)
    try { await authApi.revokeApiKey(token, id); setKeys((ks) => ks.filter((k) => k.id !== id)); toast('已撤销', 'success') }
    catch (e) { toast((e as Error).message, 'warn') } finally { setRevoking(null) }
  }
  function copy(text: string, tag: string) {
    navigator.clipboard?.writeText(text); setCopied(tag); setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500)
  }

  const curl = `curl ${base}/chat/completions \\
  -H "Authorization: Bearer $NAVO7_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"navo7-local","messages":[{"role":"user","content":"你好"}]}'`

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">对外 API · {keys.length}</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
          <KeyRound size={10} /> OpenAI 兼容
        </span>
        {loading && <Loader2 size={13} className="animate-spin text-slate-300" />}
        <button
          onClick={() => setDocOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
        >
          <BookOpen size={13} /> 接入文档
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        把你绑定的本地算力开放成标准接口：第三方用你签发的 Key 调 OpenAI 兼容的 <code className="rounded bg-slate-100 px-1">/v1/chat/completions</code>，请求会路由到你<b>在线的机器</b>上真跑 claude 并返回。可直接用 OpenAI SDK（改 base_url + key）。
      </p>

      {/* 接入信息 */}
      <div className="mb-3 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Field label="Base URL" value={base} onCopy={() => copy(base, 'base')} copied={copied === 'base'} />
        <Field label="Model" value="navo7-local" onCopy={() => copy('navo7-local', 'model')} copied={copied === 'model'} />
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">示例（curl）</span>
            <button onClick={() => copy(curl, 'curl')} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100">
              {copied === 'curl' ? <Check size={11} /> : <Copy size={11} />} {copied === 'curl' ? '已复制' : '复制'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-200"><Terminal size={11} className="mr-1 inline text-slate-500" />{curl}</pre>
        </div>
      </div>

      {/* 安全提示 */}
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600 ring-1 ring-slate-200">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-slate-400" />
        <span>
          默认<b className="text-emerald-700">受限模式</b>：纯文本对话、<b>禁用全部工具</b>，第三方无法在你机器上执行任何命令，可放心对外。
          仅当你勾选<b className="text-amber-700">代理模式</b>时，该 Key 才能让 claude 调用工具/执行命令——那种 Key 权限极高，只发给完全信任的一方，泄露立即撤销。
        </span>
      </div>

      {/* 刚生成的明文 */}
      {fresh && (
        <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
          <div className="mb-1.5 text-[12px] font-semibold text-emerald-800">新 Key 已生成 · 只显示这一次，请立即复制保存</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white px-2.5 py-2 font-mono text-[12px] text-slate-700 ring-1 ring-emerald-200">{fresh}</code>
            <button onClick={() => copy(fresh, 'fresh')} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-2 text-[12px] font-medium text-white hover:bg-emerald-700">
              {copied === 'fresh' ? <Check size={13} /> : <Copy size={13} />} {copied === 'fresh' ? '已复制' : '复制'}
            </button>
            <button onClick={() => setFresh(null)} className="rounded-lg px-2 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-100">知道了</button>
          </div>
        </div>
      )}

      {/* 生成 */}
      <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !creating && create()}
            placeholder="给这把 Key 起个名（如：合作方A / 我的脚本）"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button onClick={create} disabled={creating} className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 生成 API Key
          </button>
        </div>
        <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px]">
          <input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} className="mt-0.5 accent-amber-600" />
          <span className={agent ? 'text-amber-700' : 'text-slate-500'}>
            代理模式（允许该 Key 调用工具 / 在你机器上执行命令）
            <span className="text-slate-400"> · 不勾即默认「受限」纯文本，更安全</span>
          </span>
        </label>
      </div>

      {/* 列表 */}
      {keys.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">还没有 Key。生成一把，发给第三方即可调用你的本地算力。</div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><KeyRound size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{k.name}</span>
                  <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', k.agent ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                    {k.agent ? '代理 · 可执行' : '受限 · 纯文本'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
                  <span className="font-mono">{k.prefix}</span>
                  <span>建于 {fmt(k.createdAt)}</span>
                  <span>最近使用 {fmt(k.lastUsedAt)}</span>
                </div>
              </div>
              <button
                onClick={() => revoke(k.id)}
                disabled={revoking === k.id}
                title="撤销这把 Key（立即失效，不可恢复）"
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-60"
              >
                {revoking === k.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} 撤销
              </button>
            </div>
          ))}
        </div>
      )}

      {docOpen && (
        <Modal open onClose={() => setDocOpen(false)} title="对外 API 接入文档" wide>
          <div
            className="prose prose-slate prose-sm max-w-none prose-headings:font-semibold prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-table:text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(API_DOC, new Map()) }}
          />
        </Modal>
      )}
    </section>
  )
}

function Field({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-500">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] text-slate-700 ring-1 ring-slate-100">{value}</code>
        <button onClick={onCopy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" title="复制">
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}
