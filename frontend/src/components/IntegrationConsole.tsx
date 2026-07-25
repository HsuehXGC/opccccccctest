import { useState } from 'react'
import { Loader2, Play, Terminal, Wrench, ShieldCheck, Square } from 'lucide-react'
import { runExecutorStream, type LiveMachine } from '../lib/authApi'
import { INTEGRATION_PRESETS, integrationPrompt, type IntegrationPreset } from '../lib/integration'
import { cx } from '../lib/ui'
import { toast } from '../lib/toast'

// 系统集成台：对着隐藏算力（mini 的集成 agent）下达运维/诊断指令，claude 在本机跑、结果流式回来。
export function IntegrationConsole({ token, machine }: { token: string; machine: LiveMachine }) {
  const claudeExec = machine.executors.find((e) => e.kind === 'claude')
  const [preset, setPreset] = useState<IntegrationPreset | null>(null)
  const [instruction, setInstruction] = useState('')
  const [allowWrite, setAllowWrite] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [done, setDone] = useState(false)
  const stopRef = useState<{ stop: boolean }>({ stop: false })[0]

  function pick(p: IntegrationPreset) {
    setPreset(p)
    setInstruction(p.instruction)
    if (p.needsWrite) setAllowWrite(true)
  }

  async function run() {
    if (!claudeExec) { toast('这台集成机上没探测到 claude 执行器', 'warn'); return }
    if (!instruction.trim()) { toast('先选个预设或写一句指令', 'warn'); return }
    setRunning(true); setDone(false); setOutput(''); stopRef.stop = false
    try {
      await runExecutorStream(
        token,
        { executorId: claudeExec.id, prompt: integrationPrompt(instruction, allowWrite) },
        (e) => {
          if (stopRef.stop) return
          if (e.t === 'chunk' && !e.text.startsWith('[agent]')) setOutput((o) => o + e.text)
          else if (e.t === 'done') { if (e.result) setOutput(e.result); setDone(true) }
          else if (e.t === 'error') { setOutput((o) => o + `\n\n✗ ${e.error}`); setDone(true) }
        },
      )
    } catch (err) {
      setOutput((o) => o + `\n\n✗ ${(err as Error).message}`)
    } finally {
      setRunning(false); setDone(true)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-brand/20 bg-brand-soft/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
        <Wrench size={13} /> 系统集成台
        <span className="font-normal text-slate-400">· 在这台隐藏算力上跑运维 / 诊断 / 修复</span>
      </div>

      {/* 预设 */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {INTEGRATION_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => pick(p)}
            disabled={running}
            title={p.desc}
            className={cx(
              'rounded-lg border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-50',
              preset?.key === p.key ? 'border-brand bg-white text-brand' : 'border-slate-200 bg-white/60 text-slate-600 hover:border-brand/40',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        disabled={running}
        placeholder="选个预设，或直接写：让集成 agent 在这台机器上做什么…"
        className="mb-2 h-20 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[12px] outline-none focus:border-brand disabled:bg-slate-50"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium ring-1', allowWrite ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-500 ring-slate-200')}>
          <input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} disabled={running} className="accent-amber-600" />
          {allowWrite ? '允许变更 / 修复' : '只读诊断'}
        </label>
        {!allowWrite && <span className="flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck size={11} /> 只勘察给建议，不改系统</span>}
        <div className="ml-auto flex gap-2">
          {running && (
            <button
              onClick={() => { stopRef.stop = true; setRunning(false); setDone(true) }}
              className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-200"
            >
              <Square size={12} /> 停止接收
            </button>
          )}
          <button
            onClick={run}
            disabled={running || !claudeExec}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {running ? '执行中…' : '在集成 agent 上运行'}
          </button>
        </div>
      </div>

      {(output || running) && (
        <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-emerald-200">
          <div className="mb-1 flex items-center gap-1 text-slate-400">
            <Terminal size={11} /> 集成 agent · {machine.machine.name}{done ? ' · 完成' : running ? ' · 运行中' : ''}
          </div>
          {output || '（等待输出…）'}
        </div>
      )}
    </div>
  )
}
