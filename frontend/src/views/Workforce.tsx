import { useState, useEffect } from 'react'
import { Plus, Pause, Play, Power, Cpu, SlidersHorizontal, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi, runExecutorStream, type LiveMachine } from '../lib/authApi'
import { Avatar, BOT_STATUS, StatusDot, cx } from '../lib/ui'
import { Modal, Field, inputCls } from '../components/Modal'
import { CharterModal } from '../components/CharterModal'
import { toast } from '../lib/toast'
import type { Bot, BotRole, BotCharter } from '../types'

// 让 claude 把一段 LinkedIn/简历 profile 提炼成岗位 + charter，严格输出 JSON
function profileToRolePrompt(profile: string): string {
  return [
    '你是资深 HR 与组织设计专家。下面是一段 LinkedIn / 简历 profile 文本。',
    '请据此提炼出这个人最适合承担的**一个虚拟员工岗位**，并写出岗位说明书（charter）。',
    '**只输出严格 JSON**（不要 markdown 代码块、不要多余解释）：',
    '{',
    '  "role": "岗位名（4-8字中文，如 增长营销 / 财务分析 / 数据科学）",',
    '  "name": "一个合适的英文花名（如 Sirius / Vega）",',
    '  "mission": "一句话定位与使命",',
    '  "canDo": ["能做什么，4-6条，具体可执行"],',
    '  "cannotDo": ["边界/不能做什么，3-4条"],',
    '  "coreSkills": ["核心技能，4-6个短词"]',
    '}',
    '',
    'profile：',
    '"""',
    profile.slice(0, 6000),
    '"""',
  ].join('\n')
}

const ROLES: BotRole[] = ['产品经理', '项目经理', '全栈工程', '前端', '后端', '数据分析', '文案运营', '测试', '调研', '财务分析', '商业分析', '商业策划', '用户研究', 'UI测试']
const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']

function BotCard({ bot }: { bot: Bot }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === bot.currentTaskId))
  const setBotStatus = useStore((s) => s.setBotStatus)
  const [configOpen, setConfigOpen] = useState(false)
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

      {/* 配置提示词 */}
      <button
        onClick={() => setConfigOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
      >
        <SlidersHorizontal size={13} /> 配置提示词
      </button>

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

      {configOpen && <CharterModal bot={bot} onClose={() => setConfigOpen(false)} />}
    </div>
  )
}

export function Workforce() {
  const allBots = useStore((s) => s.bots)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const deployBot = useStore((s) => s.deployBot)
  const bots = allBots.filter((b) => b.orgId === currentOrgId)
  const [open, setOpen] = useState(false)

  const token = useAuth((s) => s.token)
  const [name, setName] = useState('')
  const [role, setRole] = useState<BotRole>('全栈工程')
  const [model, setModel] = useState(MODELS[0])
  const [skills, setSkills] = useState('')
  // 从 LinkedIn/简历生成
  const [profile, setProfile] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genCharter, setGenCharter] = useState<BotCharter | null>(null)
  const [machines, setMachines] = useState<LiveMachine[]>([])
  useEffect(() => {
    if (!open || !token) return
    let alive = true
    const load = () => authApi.machines(token).then((r) => alive && setMachines(r.machines)).catch(() => {})
    load()
    const id = setInterval(load, 6000)
    return () => { alive = false; clearInterval(id) }
  }, [open, token])
  const execId = machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors).find((e) => e.status === 'idle')?.id
    || machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors)[0]?.id || ''

  async function generateFromProfile() {
    if (!token || !profile.trim() || generating) return
    if (!execId) { toast('需要一台在线执行器来生成（团队与账户 → 本地算力）', 'warn'); return }
    setGenerating(true)
    let acc = ''
    try {
      await runExecutorStream(token, { executorId: execId, prompt: profileToRolePrompt(profile) }, (e) => {
        if (e.t === 'chunk' && !e.text.startsWith('[agent]')) acc += e.text
      })
      const m = acc.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('没解析出结果')
      const g = JSON.parse(m[0]) as { role?: string; name?: string; mission?: string; canDo?: string[]; cannotDo?: string[]; coreSkills?: string[] }
      if (g.name) setName(g.name)
      if (g.role) setRole(g.role as BotRole)
      if (g.coreSkills?.length) setSkills(g.coreSkills.join(', '))
      setGenCharter({
        mission: g.mission || '',
        canDo: g.canDo ?? [],
        cannotDo: g.cannotDo ?? [],
        coreSkills: g.coreSkills ?? [],
      })
      toast('已生成岗位与提示词，可再微调后部署', 'success')
    } catch (err) {
      toast('生成失败：' + (err as Error).message, 'warn')
    } finally {
      setGenerating(false)
    }
  }

  function resetForm() {
    setName(''); setSkills(''); setRole('全栈工程'); setModel(MODELS[0])
    setProfile(''); setGenCharter(null)
  }

  function submit() {
    if (!name.trim()) return
    deployBot({
      name: name.trim(),
      role,
      model,
      skills: skills.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6),
      charter: genCharter ?? undefined,
    })
    resetForm()
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

      <Modal open={open} onClose={() => { setOpen(false); resetForm() }} title="部署新机器人">
        <div className="mb-4 rounded-xl border border-brand/20 bg-brand-soft/30 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand"><Sparkles size={13} /> 从 LinkedIn / 简历生成岗位（可选）</div>
          <textarea
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder="粘贴一段 LinkedIn profile 或简历，AI 帮你提炼岗位、技能与提示词，自动填入下面…"
            className="mb-2 h-24 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[12px] outline-none focus:border-brand"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={generateFromProfile}
              disabled={generating || !profile.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {generating ? '生成中…' : 'AI 生成岗位与提示词'}
            </button>
            {genCharter && <span className="text-[11px] font-medium text-emerald-600">✓ 已生成岗位说明书，部署后可在「岗位说明书」再改</span>}
            {!execId && <span className="text-[11px] text-amber-600">· 需在线执行器</span>}
          </div>
        </div>
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
            {(ROLES.includes(role) ? ROLES : [role, ...ROLES]).map((r) => (
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
            onClick={() => { setOpen(false); resetForm() }}
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
