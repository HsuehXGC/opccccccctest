import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi } from './authApi'
import { buildProjectKnowledge, turnHead, turnTail, roundDirectiveText, pmHead, pmTail } from './meeting'
import type { Bot, MeetingKind } from '../types'

// 复用「建会议 → 构造各角色 prompt payload → 云端编排开跑」的完整流程（供秘书动作卡调用）。
// 与 Meetings.tsx 的 runMeeting 同构；会议按 projectId 圈定知识范围，focus 落到该项目首个产品。
export async function convokeMeeting(opts: {
  projectId: string
  title: string
  agenda: string
  kind: MeetingKind
  participantBotIds: string[]
  rounds?: number
  parallel?: boolean
}): Promise<{ ok: boolean; error?: string; meetingId?: string }> {
  const st = useStore.getState()
  const token = useAuth.getState().token
  if (!token) return { ok: false, error: '未登录' }

  const project = st.projects.find((p) => p.id === opts.projectId)
  if (!project) return { ok: false, error: '找不到项目' }
  const parts = opts.participantBotIds.map((id) => st.bots.find((b) => b.id === id)).filter((b): b is Bot => !!b)
  if (parts.length === 0) return { ok: false, error: '没有可参会的虚拟员工' }

  const projectProducts = st.products.filter((p) => p.projectId === project.id)
  const productId = projectProducts[0]?.id ?? null // 会议 focus 落到项目首个产品
  const rounds = Math.max(1, opts.rounds ?? 2)

  const meetingId = st.createMeeting({
    title: opts.title, agenda: opts.agenda, kind: opts.kind, productId,
    participantBotIds: opts.participantBotIds, references: '', fullDocSlugs: [], parallel: opts.parallel ?? true, rounds,
  })
  const meeting = useStore.getState().meetings.find((m) => m.id === meetingId)
  if (!meeting) return { ok: false, error: '创建会议失败' }

  const product = productId ? projectProducts.find((p) => p.id === productId) ?? null : null
  const ppIds = new Set(projectProducts.map((p) => p.id))
  const pm = parts.find((b) => b.role === '产品经理') || st.bots.find((b) => b.role === '产品经理') || parts[0]

  const knowledge = buildProjectKnowledge({
    projectName: project.name,
    projectDesc: project.description ?? '',
    products: projectProducts,
    requirements: st.requirements.filter((r) => r.productId && ppIds.has(r.productId)),
    docs: st.docs.filter((d) => ppIds.has(d.productId)),
    tasks: st.tasks.filter((t) => t.productId && ppIds.has(t.productId)),
    focusProductId: productId,
    references: '',
    fullDocSlugs: [],
    includeTaskOutputs: opts.kind === 'docgen',
  })

  const turns = parts.map((bot) => ({
    botId: bot.id, name: bot.name, role: bot.role, avatarSeed: bot.avatarSeed,
    head: turnHead(bot, meeting, product, knowledge), tail: turnTail(bot),
  }))
  const payload = {
    meeting, rounds, parallel: !!meeting.parallel, kind: meeting.kind, turns,
    roundDirectives: Array.from({ length: rounds - 1 }, (_, i) => roundDirectiveText(i + 2)),
    pm: { head: pmHead(pm, meeting, product, knowledge, meeting.kind), tail: pmTail(meeting.kind) },
  }
  try {
    await authApi.runMeeting(token, meetingId, payload)
    useStore.getState().setMeetingStatus(meetingId, 'running')
    return { ok: true, meetingId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
