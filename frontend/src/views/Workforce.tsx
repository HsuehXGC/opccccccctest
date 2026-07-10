import { useState } from 'react'
import { Plus, Pause, Play, Power, Cpu } from 'lucide-react'
import { useStore } from '../store/useStore'
import { Avatar, BOT_STATUS, StatusDot, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import type { Bot, BotRole } from '../types'

const ROLES: BotRole[] = ['全栈工程', '前端', '后端', '数据分析', '文案运营', '测试', '调研']
const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']

function BotCard({ bot }: { bot: Bot }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === bot.currentTaskId))
  const setBotStatus = useStore((s) => s.setBotStatus)
  const s = BOT_STATUS[bot.status]

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <Avatar seed={bot.avatarSeed} name={bot.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{bot.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
              {bot.role}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
            <Cpu size={11} /> {bot.model}
          </div>
        </div>
        <StatusDot status={bot.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {bot.skills.map((sk) => (
          <span key={sk} className="rounded-md bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-100">
            {sk}
          </span>
        ))}
      </div>

      {/* 当前任务 */}
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        {task ? (
          <>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              当前任务
            </div>
            <div className="mb-2 truncate text-sm font-medium">{task.title}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${task.progress}%` }} />
            </div>
          </>
        ) : (
          <div className="py-1 text-center text-xs text-slate-400">
            {bot.status === 'offline' ? '已离线' : '空闲 · 待接任务'}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">累计完成 {bot.completed} 个任务</span>
        <div className="flex gap-1">
          {bot.status === 'offline' ? (
            <button
              onClick={() => setBotStatus(bot.id, 'idle')}
              className="flex items-center gap-1 rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-indigo-100"
            >
              <Power size={13} /> 上线
            </button>
          ) : bot.status === 'paused' ? (
            <button
              onClick={() => setBotStatus(bot.id, bot.currentTaskId ? 'working' : 'idle')}
              className="flex items-center gap-1 rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-indigo-100"
            >
              <Play size={13} /> 恢复
            </button>
          ) : (
            <button
              onClick={() => setBotStatus(bot.id, 'paused')}
              className={cx(
                'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              <Pause size={13} /> 暂停
            </button>
          )}
          <button
            onClick={() => setBotStatus(bot.id, 'offline')}
            className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200"
            title="下线"
          >
            <Power size={13} />
          </button>
        </div>
      </div>
      <span className={cx('sr-only', s.text)}>{s.label}</span>
    </div>
  )
}

export function Workforce() {
  const { bots, deployBot } = useStore()
  const [open, setOpen] = useState(false)

  const [name, setName] = useState('')
  const [role, setRole] = useState<BotRole>('全栈工程')
  const [model, setModel] = useState(MODELS[0])
  const [skills, setSkills] = useState('')

  function submit() {
    if (!name.trim()) return
    deployBot({
      name: name.trim(),
      role,
      model,
      skills: skills.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    })
    setName('')
    setSkills('')
    setRole('全栈工程')
    setModel(MODELS[0])
    setOpen(false)
  }

  const online = bots.filter((b) => b.status !== 'offline').length

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">虚拟人力</h1>
          <p className="mt-1 text-sm text-slate-500">
            {bots.length} 个机器人 · {online} 在岗。每个机器人是一个独立的 Claude CLI 会话。
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> 部署机器人
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bots.map((b) => (
          <BotCard key={b.id} bot={b} />
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="部署新机器人">
        <Field label="名称">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Sirius"
            autoFocus
          />
        </Field>
        <Field label="角色">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                  role === r
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="底层模型">
          <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="技能标签（逗号分隔）">
          <input
            className={inputCls}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="React, TypeScript, 系统设计"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            部署
          </button>
        </div>
      </Modal>
    </div>
  )
}
