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
export async function streamTurn(orgId: string, prompt: string, onChunk: (acc: string) => void): Promise<string> {
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

// ── Seam2：会议 → backlog 写回 ─────────────────────────────────
// 任何挂了项目的会议结束后，据会议记录+现有 backlog 提炼出「新增/关闭」的 backlog 条目，落到 tasks 表。
// 新增 = status=backlog（会进 Kanban，也被自驾 projectSpec 读取喂下一轮）；关闭 = 已交付/作废的现有条目置 done。
// 失败绝不影响会议本身。返回 {added, closed} 供纪要展示。
async function applyMeetingBacklog(orgId: string, meeting: any): Promise<{ added: number; closed: number }> {
  const projectId = meeting.projectId
  if (!projectId) return { added: 0, closed: 0 }
  // 解析产品：优先会议指定的 productId，否则取该项目第一个产品
  let productId = meeting.productId as string | null
  if (!productId) {
    const prod = await one<{ id: string }>(`SELECT id FROM products WHERE project_id=$1 ORDER BY created_at LIMIT 1`, [projectId]).catch(() => null)
    productId = prod?.id ?? null
  }
  if (!productId) return { added: 0, closed: 0 }

  const openTasks = await q<{ id: string; title: string }>(
    `SELECT id, title FROM tasks WHERE product_id=$1 AND lower(status) IN ('backlog','todo','ready','open','planned') ORDER BY created_at DESC LIMIT 40`,
    [productId],
  ).catch(() => [] as any[])

  const prompt =
    `以下是一场已结束会议的完整记录与结论。请据此更新项目待办 backlog。\n\n` +
    `【会议记录】\n${transcript(meeting.messages)}\n\n` +
    (meeting.output ? `【会议纪要/结论】\n${meeting.output}\n\n` : '') +
    `【当前未完成 backlog】\n${openTasks.length ? openTasks.map((t) => `- ${t.title}`).join('\n') : '（空）'}\n\n` +
    `只输出下面两类行（不要多余解释、不要 markdown 代码块）：\n` +
    `- 每个需要新增的待办一行：\`ADD: 标题 ｜ 一句话简述 ｜ high 或 medium 或 low\`\n` +
    `- 每个已交付或已作废、应关闭的现有待办一行：\`DONE: 该现有待办标题里的关键词\`\n` +
    `会议未产生 backlog 变化时，什么都不输出。最多 8 条 ADD。`

  let out = ''
  try {
    out = await streamTurn(orgId, prompt, () => {})
  } catch {
    return { added: 0, closed: 0 } // 无执行器等 → 静默跳过
  }

  const adds: { title: string; brief: string; prio: string }[] = []
  const dones: string[] = []
  for (const line of out.split('\n')) {
    const a = line.match(/ADD\s*[:：]\s*(.+)/)
    if (a) {
      const c = a[1].split(/[｜|]/).map((s) => s.replace(/[`*]/g, '').trim())
      if (c[0]) adds.push({ title: c[0].slice(0, 80), brief: (c[1] || c[0]).slice(0, 200), prio: /high|高/.test(c[2] || '') ? 'high' : /low|低/.test(c[2] || '') ? 'low' : 'medium' })
      continue
    }
    const d = line.match(/DONE\s*[:：]\s*(.+)/)
    if (d) { const kw = d[1].replace(/[`*]/g, '').trim(); if (kw) dones.push(kw.slice(0, 40)) }
  }

  let closed = 0
  for (const kw of dones.slice(0, 20)) {
    const r = await q(
      `UPDATE tasks SET status='done' WHERE product_id=$1 AND lower(status) IN ('backlog','todo','ready','open','planned') AND title ILIKE '%'||$2||'%'`,
      [productId, kw],
    ).catch(() => ({ rowCount: 0 } as any))
    closed += (r as any).rowCount ?? 0
  }

  let added = 0
  const nowMs = Date.now()
  for (const it of adds.slice(0, 8)) {
    const id = 'task_' + randomUUID().slice(0, 8)
    const raw = { id, productId, title: it.title, brief: it.brief, description: '', kind: 'work', status: 'backlog', priority: it.prio, requirementId: null, botId: null, targetDocSlug: null, output: null, progress: 0, dependsOn: [], log: [], createdAt: nowMs, source: 'meeting:' + meeting.id }
    await q(
      `INSERT INTO tasks (id, product_id, org_id, title, description, kind, status, priority, brief, progress, depends_on, log, created_at, raw)
       VALUES ($1,$2,$3,$4,'','work','backlog',$5,$6,0,'[]','[]',$7,$8) ON CONFLICT (id) DO NOTHING`,
      [id, productId, orgId, it.title, it.prio, it.brief, nowMs, JSON.stringify(raw)],
    ).catch(() => {})
    added++
  }

  if (added || closed) notifyOrg(orgId, 'state')
  return { added, closed }
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
    // Seam2：据会议结论写回 backlog（挂了项目的会议才做；失败不影响会议）
    try {
      const bl = await applyMeetingBacklog(orgId, meeting)
      if (bl.added || bl.closed) meeting.output += `\n\n📋 backlog 已更新：新增 ${bl.added} 项、关闭 ${bl.closed} 项。`
    } catch { /* 静默 */ }

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
