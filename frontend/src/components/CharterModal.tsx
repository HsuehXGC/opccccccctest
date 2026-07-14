import { useMemo, useState } from 'react'
import { X, Plus, RotateCcw, CheckCircle2, Ban, Sparkles, Terminal } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cx } from '../lib/ui'
import { toast } from '../lib/toast'
import { DEFAULT_CHARTERS, FALLBACK_CHARTER, charterOf, assembleSystemPrompt } from '../lib/botCharter'
import type { Bot } from '../types'

function ListEditor({
  items,
  onChange,
  placeholder,
  tone = 'slate',
}: {
  items: string[]
  onChange: (v: string[]) => void
  placeholder: string
  tone?: 'emerald' | 'rose' | 'indigo' | 'slate'
}) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim()
    if (t && !items.includes(t)) onChange([...items, t])
    setV('')
  }
  const chip: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  }
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span key={i} className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ring-1', chip[tone])}>
              {it}
              <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="opacity-60 hover:opacity-100">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button onClick={add} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-200">
          <Plus size={13} /> 加
        </button>
      </div>
    </div>
  )
}

export function CharterModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const updateBotCharter = useStore((s) => s.updateBotCharter)
  const init = charterOf(bot)
  const [mission, setMission] = useState(init.mission)
  const [canDo, setCanDo] = useState<string[]>(init.canDo)
  const [cannotDo, setCannotDo] = useState<string[]>(init.cannotDo)
  const [coreSkills, setCoreSkills] = useState<string[]>(init.coreSkills)

  const preview = useMemo(
    () => assembleSystemPrompt(bot, { mission, canDo, cannotDo, coreSkills }),
    [bot, mission, canDo, cannotDo, coreSkills],
  )

  function resetDefault() {
    const d = DEFAULT_CHARTERS[bot.role] ?? FALLBACK_CHARTER
    setMission(d.mission)
    setCanDo([...d.canDo])
    setCannotDo([...d.cannotDo])
    setCoreSkills([...d.coreSkills])
  }

  function save() {
    updateBotCharter(bot.id, { mission: mission.trim(), canDo, cannotDo, coreSkills })
    toast(`已保存「${bot.name}」的岗位说明书`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">配置提示词 · {bot.name}</h3>
            <p className="mt-0.5 text-xs text-slate-400">{bot.role} · 岗位说明书将作为执行任务时的 system prompt</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetDefault} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">
              <RotateCcw size={13} /> 恢复角色默认
            </button>
            <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
          {/* 编辑 */}
          <div className="space-y-4 overflow-y-auto border-slate-100 px-5 py-4 md:border-r">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Sparkles size={12} /> 定位与使命
              </div>
              <textarea
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                className="h-20 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                placeholder="一段话说明这个角色的定位与目标"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                <CheckCircle2 size={12} /> 能做什么 · 职责范围
              </div>
              <ListEditor items={canDo} onChange={setCanDo} placeholder="添加一条职责，回车" tone="emerald" />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-600">
                <Ban size={12} /> 不能做什么 · 边界
              </div>
              <ListEditor items={cannotDo} onChange={setCannotDo} placeholder="添加一条边界，回车" tone="rose" />
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
                <Sparkles size={12} /> 核心技能
              </div>
              <ListEditor items={coreSkills} onChange={setCoreSkills} placeholder="添加一项技能，回车" tone="indigo" />
            </div>
          </div>

          {/* 预览 */}
          <div className="flex flex-col overflow-hidden bg-slate-50/50">
            <div className="flex items-center gap-1.5 px-5 pt-4 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <Terminal size={12} /> 组装后的 system prompt · 执行时 prepend 到任务 brief 前
            </div>
            <pre className="m-4 flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-emerald-200">
              {preview}
            </pre>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
            取消
          </button>
          <button onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
