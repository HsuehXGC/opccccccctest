import { randomUUID } from 'node:crypto'
import { gateway } from './agentGateway.ts'
import type { JobEvent } from './agentProtocol.ts'
import { q, one } from './db.ts'
import { notifyOrg } from './bus.ts'

// ── 云端会议编排器 ─────────────────────────────────────────────
// 前端构建各角色 prompt 片段（head/tail，逻辑单一来源在 meeting.ts），后端按轮次
// 编排、流式派单、把发言/产出逐步落库到 meetings.raw。关页面不中断；进程重启可恢复。

const TURN_TIMEOUT = 300_000
const SAVE_THROTTLE_MS = 1500

export interface MeetingRunPayload {
  meeting: any
  rounds: number
  parallel: boolean
  kind: string
  turns: { botId: string; name: string; role: string; avatarSeed?: string; head: string; tail: string }[]
  roundDirectives: string[]
  pm: { head: string; tail: string }
}

const running = new Set<string>()
export const isMeetingRunning = (id: string) => running.has(id)

function pickExec(orgId: string): string | null {
  const execs = gateway.listMachines().filter((m) => m.accountId === orgId && m.online).flatMap((m) => m.executors)
  return execs.find((e) => e.status === 'idle')?.id || execs[0]?.id || null
}
export const orgHasExecutor = (orgId: string) => pickExec(orgId) !== null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 流式派单：把 chunk 通过 onChunk 回调持续吐出，done 时 resolve 最终结果。
 *  开跑前等待在线执行器最多 60s（应对 agent 短暂离线 / 进程重启后重连）。 */
async function streamTurn(orgId: string, prompt: string, onChunk: (acc: string) => void): Promise<string> {
  let exec = pickExec(orgId)
  for (let i = 0; !exec && i < 60; i++) { await sleep(1000); exec = pickExec(orgId) }
  const chosen = exec
  if (!chosen) throw new Error('无在线执行器')
  return new Promise((resolve, reject) => {
    let remoteId = ''
    let acc = ''
    let idle: NodeJS.Timeout
    const arm = () => {
      clearTimeout(idle)
      idle = setTimeout(() => { cleanup(); reject(new Error('执行器 300 秒无响应')) }, TURN_TIMEOUT)
    }
    const cleanup = () => { clearTimeout(idle); gateway.off('job', onJob) }
    const onJob = (e: JobEvent) => {
      if (e.jobId !== remoteId) return
      arm()
      if (e.type === 'chunk') { acc += e.text; onChunk(acc) }
      else if (e.type === 'done') { cleanup(); resolve((e.result || acc).trim()) }
      else if (e.type === 'error') { cleanup(); reject(new Error(e.error)) }
    }
    gateway.on('job', onJob)
    try {
      remoteId = gateway.dispatch(chosen, prompt, undefined, undefined).jobId
    } catch (err) {
      cleanup()
      reject(err as Error)
      return
    }
    arm()
  })
}

function transcript(msgs: any[]): string {
  const arr = msgs.filter((m) => m.content && String(m.content).trim() && !String(m.content).startsWith('__typing__'))
  if (!arr.length) return '（暂无发言）'
  return arr.map((m) => `【${m.speakerName}${m.speakerRole ? ' · ' + m.speakerRole : ''}】\n${String(m.content).trim()}`).join('\n\n')
}

/** 编排一场会议：多轮（顺序/并行）流式发言 → PM 整理 → 落库 */
export async function orchestrateMeeting(orgId: string, payload: MeetingRunPayload): Promise<void> {
  const meeting = payload.meeting
  const meetingId = meeting.id
  if (running.has(meetingId)) return
  running.add(meetingId)

  let lastSave = 0
  let saveTimer: NodeJS.Timeout | null = null
  const persist = async () => {
    await q(`UPDATE meetings SET raw=$2, status=$3, output=$4 WHERE id=$1`, [meetingId, JSON.stringify(meeting), meeting.status ?? 'running', meeting.output ?? ''])
    notifyOrg(orgId, 'meetings')
  }
  const save = async (force = false) => {
    if (force) { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null } ; lastSave = Date.now(); return persist() }
    const dt = Date.now() - lastSave
    if (dt >= SAVE_THROTTLE_MS) { lastSave = Date.now(); return persist() }
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; lastSave = Date.now(); void persist() }, SAVE_THROTTLE_MS - dt)
  }

  try {
    // upsert 会议 + 存编排负载（供重启恢复）+ 复位为运行中、清空发言
    meeting.status = 'running'
    meeting.output = ''
    meeting.messages = []
    await q(
      `INSERT INTO meetings (id, org_id, project_id, product_id, title, agenda, kind, status, participant_bot_ids, refs, full_doc_slugs, parallel, rounds, output, created_at, raw, run_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8,$9,$10,$11,$12,'',$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET status='running', output='', raw=$14, run_payload=$15`,
      [meetingId, orgId, meeting.projectId ?? null, meeting.productId ?? null, meeting.title ?? '', meeting.agenda ?? '', payload.kind,
       JSON.stringify(meeting.participantBotIds ?? []), meeting.references ?? '', JSON.stringify(meeting.fullDocSlugs ?? []), !!payload.parallel, payload.rounds, meeting.createdAt ?? 0,
       JSON.stringify(meeting), JSON.stringify(payload)],
    )

    const { rounds, parallel, turns, roundDirectives, pm } = payload
    const turnPrompt = (t: MeetingRunPayload['turns'][number], prior: any[], r: number) =>
      t.head + transcript(prior) + '\n' + (r === 1 ? t.tail : roundDirectives[r - 2] ?? '')

    // 创建一条空发言（流式回填用），返回消息对象
    const newMsg = (t: MeetingRunPayload['turns'][number], round: number) => {
      const msg = { id: 'msg_' + randomUUID().slice(0, 8), speakerType: 'bot', speakerId: t.botId, speakerName: t.name, speakerRole: t.role, avatarSeed: t.avatarSeed ?? t.botId, content: '', round, createdAt: Date.now() }
      meeting.messages.push(msg)
      return msg
    }
    const speak = async (t: MeetingRunPayload['turns'][number], prior: any[], r: number) => {
      const msg = newMsg(t, r)
      await save(true)
      try {
        const final = await streamTurn(orgId, turnPrompt(t, prior, r), (acc) => { msg.content = acc; void save() })
        msg.content = final
      } catch (e) {
        msg.content = '⚠️ ' + (e as Error).message
      }
      await save(true)
    }

    for (let r = 1; r <= rounds; r++) {
      if (parallel) {
        const prior = meeting.messages.slice() // 本轮开始前的快照
        await Promise.all(turns.map((t) => speak(t, prior, r)))
      } else {
        for (const t of turns) await speak(t, meeting.messages.slice(), r)
      }
      console.log(`▶ meeting ${meetingId} 第 ${r}/${rounds} 轮完成`)
    }

    // PM 整理（也流式）
    const pmPrompt = pm.head + transcript(meeting.messages) + '\n' + pm.tail
    try {
      meeting.output = await streamTurn(orgId, pmPrompt, (acc) => { meeting.output = acc; void save() })
    } catch (e) {
      meeting.output = (meeting.output || '') + '\n⚠️ ' + (e as Error).message
    }
    meeting.status = 'done'
    await q(`UPDATE meetings SET raw=$2, status='done', output=$3, run_payload=NULL WHERE id=$1`, [meetingId, JSON.stringify(meeting), meeting.output])
    notifyOrg(orgId, 'meetings')
    console.log(`✓ meeting ${meetingId} 完成 · ${meeting.messages.length} 发言 · 输出 ${meeting.output.length} 字`)
  } catch (err) {
    meeting.status = 'done'
    meeting.output = (meeting.output || '') + '\n⚠️ 编排出错：' + (err as Error).message
    await q(`UPDATE meetings SET raw=$2, status='done', output=$3, run_payload=NULL WHERE id=$1`, [meetingId, JSON.stringify(meeting), meeting.output]).catch(() => {})
    notifyOrg(orgId, 'meetings')
  } finally {
    running.delete(meetingId)
  }
}

/** 进程重启后恢复运行中的会议（有编排负载则从头重跑） */
export async function recoverMeetings(): Promise<number> {
  let rows: { org_id: string; run_payload: MeetingRunPayload }[]
  try {
    rows = await q(`SELECT org_id, run_payload FROM meetings WHERE status='running' AND run_payload IS NOT NULL`)
  } catch {
    return 0
  }
  for (const row of rows) {
    if (row.run_payload?.meeting?.id) void orchestrateMeeting(row.org_id, row.run_payload)
  }
  return rows.length
}

export async function getMeeting(orgId: string, id: string): Promise<any | null> {
  const row = await one<{ raw: any }>(`SELECT raw FROM meetings WHERE id=$1 AND org_id=$2`, [id, orgId])
  return row?.raw ?? null
}
