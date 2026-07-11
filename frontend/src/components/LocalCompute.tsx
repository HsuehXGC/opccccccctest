import { useEffect, useState } from 'react'
import { Laptop, Cpu, Sparkles, Plus, Copy, ShieldCheck, Loader2, Play, Terminal, RefreshCw, Trash2 } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { authApi, type LiveMachine } from '../lib/authApi'
import { cx } from '../lib/ui'
import { Modal } from './Modal'
import { toast } from '../lib/toast'

const EXEC_DOT: Record<string, string> = { idle: 'bg-emerald-500', busy: 'bg-indigo-500 dot-pulse', offline: 'bg-slate-300' }
const EXEC_LABEL: Record<string, string> = { idle: '空闲', busy: '忙碌', offline: '离线' }

// 绑定命令（同源，自动用当前域名）
function bindCommand(token: string) {
  const origin = window.location.origin
  const wss = `${origin.replace(/^http/, 'ws')}/agent`
  return `cd ~ && curl -fsSL ${origin}/opc-agent.mjs -o opc-agent.mjs && \\\n  OPC_TOKEN=${token} OPC_URL=${wss} node opc-agent.mjs`
}

export function LocalCompute() {
  const token = useAuth((s) => s.token)!
  const [machines, setMachines] = useState<LiveMachine[]>([])
  const [loading, setLoading] = useState(true)

  const [binding, setBinding] = useState(false)
  const [enrollTok, setEnrollTok] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [copied, setCopied] = useState(false)

  // 每个执行器的测试状态
  const [tests, setTests] = useState<Record<string, { running: boolean; output?: string; ok?: boolean }>>({})

  // 删除（解绑）确认与进行态
  const [confirming, setConfirming] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  async function removeMachine(machineId: string, name: string) {
    setRemoving(machineId)
    try {
      await authApi.removeMachine(token, machineId)
      setMachines((ms) => ms.filter((m) => m.machineId !== machineId))
      toast(`已删除本地算力「${name}」`, 'success')
    } catch (e) {
      toast((e as Error).message, 'warn')
    } finally {
      setRemoving(null)
      setConfirming(null)
    }
  }

  async function refresh() {
    try {
      const { machines } = await authApi.machines(token)
      setMachines(machines)
    } catch {
      /* 忽略 */
    } finally {
      setLoading(false)
    }
  }

  // 首次加载 + 每 5s 轮询在线状态
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openBind() {
    setBinding(true)
    setEnrollTok(null)
    setCopied(false)
    setEnrolling(true)
    try {
      const { token: t } = await authApi.enrollToken(token)
      setEnrollTok(t)
    } catch (e) {
      toast((e as Error).message, 'warn')
      setBinding(false)
    } finally {
      setEnrolling(false)
    }
  }

  async function testExecutor(executorId: string) {
    setTests((s) => ({ ...s, [executorId]: { running: true } }))
    try {
      const r = await authApi.runExecutor(token, { executorId, prompt: 'Reply with exactly one word: PONG' })
      setTests((s) => ({ ...s, [executorId]: { running: false, ok: true, output: r.result } }))
      toast('执行器测试完成', 'success')
    } catch (e) {
      setTests((s) => ({ ...s, [executorId]: { running: false, ok: false, output: (e as Error).message } }))
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">本地算力 · {machines.length}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <Sparkles size={10} /> 真实 agent 接入
          </span>
          {loading && <Loader2 size={13} className="animate-spin text-slate-300" />}
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} title="刷新" className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-400 hover:bg-slate-50">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={openBind}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={15} /> 绑定电脑
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        在电脑上运行绑定命令，agent 出站接入云端，自动把本机的 claude / codex CLI 登记为执行器；派单时在这台电脑上真跑 <code className="rounded bg-slate-100 px-1">claude -p</code>。
      </p>

      {machines.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
          还没有电脑接入。点「绑定电脑」拿到命令，在目标 Mac 上运行即可。
        </div>
      ) : (
        <div className="space-y-3">
          {machines.map((m) => (
            <div key={m.machineId} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Laptop size={17} />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {m.machine.name}
                    <span className={cx('h-1.5 w-1.5 rounded-full', m.online ? 'bg-emerald-500 dot-pulse' : 'bg-slate-300')} />
                    <span className="text-[11px] font-normal text-slate-400">{m.online ? '在线' : '离线'}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{m.machine.os}</div>
                </div>
                {/* 删除（解绑）*/}
                {confirming === m.machineId ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">删除？</span>
                    <button
                      onClick={() => removeMachine(m.machineId, m.machine.name)}
                      disabled={removing === m.machineId}
                      className="flex items-center gap-1 rounded-lg bg-rose-500 px-2 py-1 font-medium text-white hover:bg-rose-600 disabled:opacity-60"
                    >
                      {removing === m.machineId ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      确认
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg px-2 py-1 font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(m.machineId)}
                    title="删除本地算力（关闭该 agent 连接并解绑）"
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {m.executors.length === 0 ? (
                <p className="text-xs text-slate-400">未探测到 claude / codex 执行器。</p>
              ) : (
                <div className="space-y-2">
                  {m.executors.map((e) => {
                    const t = tests[e.id]
                    return (
                      <div key={e.id} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-100">
                        <div className="flex items-center gap-2">
                          <Cpu size={13} className={e.kind === 'claude' ? 'text-indigo-500' : 'text-teal-500'} />
                          <span className="text-sm font-medium">{e.label}</span>
                          <span className={cx('h-1.5 w-1.5 rounded-full', EXEC_DOT[e.status])} />
                          <span className="text-[11px] text-slate-400">{EXEC_LABEL[e.status]}</span>
                          <button
                            onClick={() => testExecutor(e.id)}
                            disabled={t?.running || !m.online}
                            className="ml-auto flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-brand/30 hover:bg-brand-soft disabled:opacity-50"
                          >
                            {t?.running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            {t?.running ? '执行中…' : '测试'}
                          </button>
                        </div>
                        {t && !t.running && t.output !== undefined && (
                          <div
                            className={cx(
                              'mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg px-2.5 py-2 font-mono text-[11px] leading-relaxed',
                              t.ok ? 'bg-slate-900 text-emerald-300' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
                            )}
                          >
                            <div className="mb-1 flex items-center gap-1 text-slate-400">
                              <Terminal size={11} /> claude -p "Reply with exactly one word: PONG"
                            </div>
                            {t.output || '(空)'}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 绑定电脑 */}
      {binding && (
        <Modal open onClose={() => setBinding(false)} title="绑定本地电脑">
          <p className="mb-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            <span>
              在目标 Mac 的终端里运行下面的命令（需已装 <code className="rounded bg-slate-100 px-1">node</code> 且 <code className="rounded bg-slate-100 px-1">claude</code> 已登录）。agent 会
              <span className="font-medium text-slate-700">出站</span>接入云端，只需 443，无需公网 IP。
            </span>
          </p>

          {enrolling || !enrollTok ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-8 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" /> 生成绑定 token…
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-lg bg-slate-900 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">一行命令 · 含绑定 token（永久有效）</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(bindCommand(enrollTok))
                      setCopied(true)
                    }}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                  >
                    <Copy size={11} /> {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-emerald-300">{bindCommand(enrollTok)}</code>
              </div>
              <ol className="mb-2 space-y-1.5 text-xs text-slate-500">
                <li>1 · 在目标 Mac 终端粘贴运行，agent 出站建立连接、注册本机</li>
                <li>2 · 自动探测 claude / codex CLI，登记为执行器</li>
                <li>3 · 回到这里（几秒后自动刷新），机器会出现在上方，点执行器「测试」验证</li>
              </ol>
              <p className="text-[11px] text-slate-400">保持终端里的 agent 运行；关掉即离线。断线/后端重启会自动重连，无需重新绑定。正式部署可做成常驻服务（launchd）。</p>
            </>
          )}

          <div className="mt-4 flex justify-end">
            <button onClick={() => setBinding(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              关闭
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
