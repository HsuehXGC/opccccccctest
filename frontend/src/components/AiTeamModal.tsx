import { useEffect, useState } from 'react'
import { Sparkles, Loader2, Users, RotateCcw, Check } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi, runExecutorStream, type LiveMachine } from '../lib/authApi'
import { Modal } from './Modal'
import { cx } from '../lib/ui'
import { toast } from '../lib/toast'
import type { BotRole } from '../types'

type Member = {
  role: string
  name: string
  mission?: string
  coreSkills?: string[]
  canDo?: string[]
  cannotDo?: string[]
  reason?: string
}

const MODEL = 'claude-opus-4-8'

function teamPrompt(requirement: string, existing: { name: string; role: string }[]): string {
  return [
    '你是资深技术团队负责人 + HR。下面是一个项目的需求描述。',
    '请推荐一支「虚拟员工」团队（每个成员 = 一个独立 AI 员工），覆盖把这个项目做出来所需的关键岗位。',
    existing.length
      ? `现有团队（在其基础上**只补齐缺口**，不要重复这些岗位/人）：${existing.map((e) => `${e.name}(${e.role})`).join('、')}`
      : '这是一支从零组建的新团队。',
    '',
    '**只输出严格 JSON**（不要 markdown 代码块、不要多余解释）：',
    '{',
    '  "team": [',
    '    {',
    '      "role": "岗位名（优先用：产品经理/项目经理/全栈工程/前端/后端/数据分析/文案运营/测试/调研/财务分析/商业分析/商业策划/用户研究/UI测试；不够再自定义 4-8 字中文）",',
    '      "name": "英文花名（如 Nova / Orion / Iris，彼此不重复）",',
    '      "mission": "一句话使命",',
    '      "coreSkills": ["4-6 个短技能词"],',
    '      "canDo": ["能做什么，3-5 条，具体"],',
    '      "cannotDo": ["边界，2-3 条"],',
    '      "reason": "这个项目为什么需要这个岗位（一句话）"',
    '    }',
    '  ]',
    '}',
    '',
    '规模按项目复杂度定，一般 3-6 人，别堆人。',
    '',
    '需求：',
    '"""',
    requirement.slice(0, 6000),
    '"""',
  ].join('\n')
}

export function AiTeamModal({ onClose }: { onClose: () => void }) {
  const token = useAuth((s) => s.token)
  const currentOrgId = useStore((s) => s.currentOrgId)
  const currentProjectId = useStore((s) => s.currentProjectId)
  const currentProject = useStore((s) => s.projects.find((p) => p.id === currentProjectId))
  const allBots = useStore((s) => s.bots)
  const deployBot = useStore((s) => s.deployBot)

  // 本项目现有员工（含共享）——用于「调整/补缺」
  const existing = allBots
    .filter((b) => b.orgId === currentOrgId && (!b.projectIds?.length || b.projectIds.includes(currentProjectId)))
    .map((b) => ({ name: b.name, role: b.role as string }))

  const [requirement, setRequirement] = useState('')
  const [useExisting, setUseExisting] = useState(existing.length > 0)
  const [phase, setPhase] = useState<'input' | 'generating' | 'review'>('input')
  const [proposed, setProposed] = useState<Member[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())

  // 找一台在线执行器来生成
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
    machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors).find((e) => e.status === 'idle')?.id ||
    machines.filter((m) => m.online && !m.internal).flatMap((m) => m.executors)[0]?.id ||
    ''

  async function generate() {
    if (!token || !requirement.trim()) { toast('先描述一下项目需求', 'warn'); return }
    if (!execId) { toast('需要一台在线执行器来生成（团队与账户 → 本地算力）', 'warn'); return }
    setPhase('generating')
    let acc = ''
    try {
      await runExecutorStream(
        token,
        { executorId: execId, prompt: teamPrompt(requirement.trim(), useExisting ? existing : []) },
        (e) => { if (e.t === 'chunk' && !e.text.startsWith('[agent]')) acc += e.text },
      )
      const m = acc.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('没解析出结果')
      const parsed = JSON.parse(m[0]) as { team?: Member[] }
      const team = (parsed.team ?? []).filter((x) => x && x.role && x.name)
      if (!team.length) throw new Error('没有生成岗位')
      setProposed(team)
      setPicked(new Set(team.map((_, i) => i))) // 默认全选
      setPhase('review')
    } catch (err) {
      toast('生成失败：' + (err as Error).message, 'warn')
      setPhase('input')
    }
  }

  function deploySelected() {
    const chosen = proposed.filter((_, i) => picked.has(i))
    if (!chosen.length) { toast('至少选一个', 'warn'); return }
    for (const m of chosen) {
      deployBot({
        name: m.name.trim(),
        role: m.role.trim() as BotRole,
        model: MODEL,
        skills: (m.coreSkills ?? []).slice(0, 6),
        charter: { mission: m.mission ?? '', canDo: m.canDo ?? [], cannotDo: m.cannotDo ?? [], coreSkills: m.coreSkills ?? [] },
        projectIds: currentProjectId ? [currentProjectId] : [],
      })
    }
    toast(`已部署 ${chosen.length} 名员工到「${currentProject?.name ?? '当前项目'}」`, 'success')
    onClose()
  }

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  return (
    <Modal open onClose={onClose} title="AI 配置团队" wide>
      {phase !== 'review' ? (
        <>
          <p className="mb-2 text-[13px] text-slate-500">
            用一段话说清这个项目要做什么，AI 会为「<b>{currentProject?.name ?? '当前项目'}</b>」推荐一支合适的虚拟团队。生成后你再勾选增减、一键部署。
          </p>
          <textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="例：做一个面向本地商超的在线商店 H5，用户能浏览商品、下单、选到店取或送货上门，要有商品管理、订单、库存、支付，先出可上线的 MVP…"
            className="h-40 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand"
            disabled={phase === 'generating'}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {existing.length > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600">
                <input type="checkbox" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} className="accent-brand" disabled={phase === 'generating'} />
                参考现有 {existing.length} 名员工，只补缺口（调整而非重建）
              </label>
            )}
            {!execId && <span className="text-[12px] text-amber-600">· 需在线执行器</span>}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
            <button
              onClick={generate}
              disabled={phase === 'generating' || !requirement.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {phase === 'generating' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {phase === 'generating' ? '生成中…（约 20-40 秒）' : '生成团队方案'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-[13px] text-slate-600">
            <Users size={15} className="text-brand" /> 推荐 {proposed.length} 人 · 已选 <b>{picked.size}</b> · 取消勾选即不部署
          </div>
          <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {proposed.map((m, i) => {
              const on = picked.has(i)
              return (
                <button
                  key={i}
                  onClick={() => toggle(i)}
                  className={cx('flex flex-col rounded-xl border p-3 text-left transition', on ? 'border-brand bg-brand-soft/40' : 'border-slate-200 bg-white opacity-60 hover:opacity-100')}
                >
                  <div className="flex items-center gap-2">
                    <span className={cx('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-slate-300')}>
                      {on && <Check size={11} />}
                    </span>
                    <span className="font-semibold">{m.name}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">{m.role}</span>
                  </div>
                  {m.mission && <div className="mt-1.5 text-[12px] text-slate-600">{m.mission}</div>}
                  {m.reason && <div className="mt-1 text-[11px] text-slate-400">为什么：{m.reason}</div>}
                  {!!(m.coreSkills?.length) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.coreSkills!.slice(0, 6).map((sk) => (
                        <span key={sk} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-100">{sk}</span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button onClick={() => setPhase('input')} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
              <RotateCcw size={14} /> 重新生成
            </button>
            <button
              onClick={deploySelected}
              disabled={picked.size === 0}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <Sparkles size={15} /> 部署选中的 {picked.size} 人
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
