import { randomUUID } from 'node:crypto'
import { gateway } from './agentGateway.ts'
import { q, one } from './db.ts'

// ── 云端会议编排器 ─────────────────────────────────────────────
// 前端构建好各角色的 prompt 片段（head/tail，逻辑单一来源在 meeting.ts），
// 后端按轮次编排、派单、把发言与产出落库到 meetings.raw。关页面不中断。

const TURN_TIMEOUT = 300_000

export interface MeetingRunPayload {
  meeting: any // 前端 meeting 完整对象（用于 upsert + 落库进度）
  rounds: number
  parallel: boolean
  kind: string
  turns: { botId: string; name: string; role: string; avatarSeed?: string; head: string; tail: string }[]
  roundDirectives: string[] // rounds 2..N 的追加指令（index r-2）
  pm: { head: string; tail: string }
}

const running = new Set<string>()
export const isMeetingRunning = (id: string) => running.has(id)

function pickExec(orgId: string): string | null {
  const execs = gateway.listMachines().filter((m) => m.accountId === orgId && m.online).flatMap((m) => m.executors)
  return execs.find((e) => e.status === 'idle')?.id || execs[0]?.id || null
}

export function orgHasExecutor(orgId: string): boolean {
  return pickExec(orgId) !== null
}

async function runOne(orgId: string, prompt: string): Promise<string> {
  const exec = pickExec(orgId)
  if (!exec) throw new Error('无在线执行器')
  const { result } = await gateway.runJob(exec, prompt, undefined, TURN_TIMEOUT)
  return (result || '').trim()
}

function transcript(msgs: any[]): string {
  const arr = msgs.filter((m) => m.content && String(m.content).trim())
  if (!arr.length) return '（暂无发言）'
  return arr.map((m) => `【${m.speakerName}${m.speakerRole ? ' · ' + m.speakerRole : ''}】\n${String(m.content).trim()}`).join('\n\n')
}

/** 编排一场会议：多轮（顺序/并行）发言 → PM 整理 → 落库。异步执行，不阻塞请求。 */
export async function orchestrateMeeting(orgId: string, payload: MeetingRunPayload): Promise<void> {
  const meeting = payload.meeting
  const meetingId = meeting.id
  if (running.has(meetingId)) return
  running.add(meetingId)

  const save = async () =>
    q(`UPDATE meetings SET raw=$2, status=$3, output=$4 WHERE id=$1`, [meetingId, JSON.stringify(meeting), meeting.status ?? 'running', meeting.output ?? ''])

  try {
    // 先 upsert 会议（确保云端有它），并复位为运行中、清空发言
    await q(
      `INSERT INTO meetings (id, org_id, project_id, product_id, title, agenda, kind, status, participant_bot_ids, refs, full_doc_slugs, parallel, rounds, output, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,$9,$10,$11,$12,'',$13,$14)
       ON CONFLICT (id) DO UPDATE SET status='running', output='', raw=$14`,
      [meetingId, orgId, meeting.projectId ?? null, meeting.productId ?? null, meeting.title ?? '', meeting.agenda ?? '', payload.kind,
       JSON.stringify(meeting.participantBotIds ?? []), meeting.references ?? '', JSON.stringify(meeting.fullDocSlugs ?? []), !!payload.parallel, payload.rounds, meeting.createdAt ?? 0, JSON.stringify({ ...meeting, status: 'running', output: '', messages: [] })],
    )
    meeting.messages = []
    meeting.status = 'running'
    meeting.output = ''
    await save()

    const { rounds, parallel, turns, roundDirectives, pm } = payload
    const addMsg = async (t: MeetingRunPayload['turns'][number], round: number, content: string) => {
      meeting.messages.push({
        id: 'msg_' + randomUUID().slice(0, 8),
        speakerType: 'bot', speakerId: t.botId, speakerName: t.name, speakerRole: t.role,
        avatarSeed: t.avatarSeed ?? t.botId, content, round, createdAt: Date.now(),
      })
      await save()
    }
    const turnPrompt = (t: MeetingRunPayload['turns'][number], prior: any[], r: number) =>
      t.head + transcript(prior) + '\n' + (r === 1 ? t.tail : roundDirectives[r - 2] ?? '')

    for (let r = 1; r <= rounds; r++) {
      if (parallel) {
        const prior = [...meeting.messages]
        const results = await Promise.all(turns.map((t) => runOne(orgId, turnPrompt(t, prior, r)).catch((e) => '⚠️ ' + e.message)))
        for (let i = 0; i < turns.length; i++) await addMsg(turns[i], r, results[i])
      } else {
        for (const t of turns) {
          const content = await runOne(orgId, turnPrompt(t, [...meeting.messages], r)).catch((e) => '⚠️ ' + e.message)
          await addMsg(t, r, content)
        }
      }
      console.log(`▶ meeting ${meetingId} 第 ${r}/${rounds} 轮完成`)
    }

    const pmPrompt = pm.head + transcript(meeting.messages) + '\n' + pm.tail
    meeting.output = await runOne(orgId, pmPrompt).catch((e) => '⚠️ ' + e.message)
    meeting.status = 'done'
    await save()
    console.log(`✓ meeting ${meetingId} 完成 · ${meeting.messages.length} 发言 · 输出 ${meeting.output.length} 字`)
  } catch (err) {
    meeting.status = 'done'
    meeting.output = (meeting.output || '') + '\n⚠️ 编排出错：' + (err as Error).message
    await save().catch(() => {})
  } finally {
    running.delete(meetingId)
  }
}

/** 读取会议当前状态（前端轮询用） */
export async function getMeeting(orgId: string, id: string): Promise<any | null> {
  const row = await one<{ raw: any }>(`SELECT raw FROM meetings WHERE id=$1 AND org_id=$2`, [id, orgId])
  return row?.raw ?? null
}
