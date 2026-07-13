import { randomUUID } from 'node:crypto'
import { q, one } from './db.ts'
import { createJob, getJob } from './jobStore.ts'
import { orgHasExecutor, orchestrateMeeting } from './meetingRunner.ts'
import { notifyOrg } from './bus.ts'

// ── OPC autopilot：项目大脑，一轮一轮自主推进（Gap 1）──────────────────────
// 一轮 = 规划 → 执行(代码任务) → QA复核 → 集成 → 构建 → 测试 → 发布 → 待人工评审。
// 全程复用 job 系统（调度器执行、机器定向、持久化），关页面/重启不中断。

const running = new Set<string>() // project_id 维度，防并发
const MAX_ROUNDS = 50 // 轮次上限（防跑飞；轮间本就由人工评审 gate，此为兜底）
const now = () => Date.now()

interface Workspace {
  repoPath: string
  branch?: string
  buildCmd?: string
  testCmd?: string
  runCmd?: string
  env?: string
  machine?: string
}

// 跨轮记忆（G4.5）：把本项目历史迭代（目标 + 发布版本 + changelog）汇成一段，喂给规划
async function projectMemory(orgId: string, projectId: string, excludeId: string): Promise<string> {
  const rows = await q<{ round: number; goal: string; release_ver: string | null; changelog: string }>(
    `SELECT round, goal, release_ver, changelog FROM iterations WHERE org_id=$1 AND project_id=$2 AND id<>$3 AND status='done' ORDER BY round DESC LIMIT 6`,
    [orgId, projectId, excludeId],
  )
  if (rows.length === 0) return ''
  const lines = rows
    .slice()
    .reverse()
    .map((r) => `- 第${r.round}轮${r.release_ver ? `（发布 ${r.release_ver}）` : ''}：${r.goal}${r.changelog ? '｜改动：' + r.changelog.replace(/\n/g, ' ').slice(0, 120) : ''}`)
  return `\n## 项目历史（你之前几轮已做的，别重复、要接续）\n${lines.join('\n')}`
}

// 接缝1（会议/文档→自驾）：把项目的「PRD 最新版 + 未完成 backlog（需求/任务）」汇成一段喂给规划。
// project → products(project_id) → docs/doc_versions/requirements/tasks(product_id)。
// 无 PRD/backlog 时返回空串 → 行为回退到纯 goal 驱动，不破坏既有项目。
async function projectSpec(projectId: string): Promise<string> {
  const clip = (s: string, n: number) => (s || '').replace(/\s+$/g, '').slice(0, n)
  const parts: string[] = []

  // 1) PRD / 规格文档：正文存在 docs.raw.versions[-1].content（前端未同步到 doc_versions 表）。
  //    取每篇最新版本正文，PRD 类优先，最多 3 篇。
  const docs = await q<{ title: string; type: string; content: string }>(
    `SELECT d.title, d.type, COALESCE(d.raw->'versions'->-1->>'content', '') AS content
       FROM products p
       JOIN docs d ON d.product_id = p.id
      WHERE p.project_id = $1
      ORDER BY (d.type = 'prd') DESC, d.created_at DESC
      LIMIT 3`,
    [projectId],
  ).catch(() => [])
  const docsClean = docs.filter((d) => d.content.trim())
  if (docsClean.length) {
    parts.push(
      '## 项目规格（PRD / 设计文档，这是本项目的事实源，规划要贴着它走）\n' +
        docsClean.map((d) => `### ${d.title}（${d.type}）\n${clip(d.content, 1800)}`).join('\n\n'),
    )
  }

  // 2) 未完成 backlog：需求 + 任务（高优先在前）
  const prio = `CASE lower(priority) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`
  const reqs = await q<{ title: string; description: string }>(
    `SELECT r.title, r.description FROM requirements r JOIN products p ON p.id = r.product_id
      WHERE p.project_id = $1 AND lower(r.status) NOT IN ('done','shipped','archived','released','closed')
      ORDER BY ${prio.replace(/priority/g, 'r.priority')} LIMIT 15`,
    [projectId],
  ).catch(() => [])
  const tasks = await q<{ title: string; brief: string }>(
    `SELECT t.title, t.brief FROM tasks t JOIN products p ON p.id = t.product_id
      WHERE p.project_id = $1 AND lower(t.status) IN ('backlog','todo','ready','open','planned')
      ORDER BY ${prio.replace(/priority/g, 't.priority')} LIMIT 15`,
    [projectId],
  ).catch(() => [])
  const items = [
    ...reqs.map((r) => `- [需求] ${r.title}${r.description ? '：' + clip(r.description, 90) : ''}`),
    ...tasks.map((t) => `- [任务] ${t.title}${t.brief ? '：' + clip(t.brief, 90) : ''}`),
  ]
  if (items.length) {
    parts.push(
      '## 待办 backlog（未完成，规划时**优先从这里挑一个够本轮做完的切片**；标题尽量与被认领的条目对应）\n' +
        items.join('\n'),
    )
  }

  return parts.length ? '\n' + parts.join('\n\n') : ''
}

// ── 提示词（后端自持，不依赖浏览器）──────────────────────────
function planPrompt(projectName: string, goal: string, feedback: string, memory: string, spec: string): string {
  return [
    `你是「${projectName}」的技术负责人，正在真实代码仓库里工作（当前目录=仓库根）。`,
    `本轮目标：${goal}`,
    feedback ? `上一轮发布后的人工评审反馈（务必据此调整）：${feedback}` : '',
    spec,
    memory,
    '',
    '请先快速浏览现有代码结构，然后规划**本轮 1–2 个小而具体、低风险、可独立实现并提交**的任务，朝目标推进。',
    spec ? '**优先从上面的 backlog 里挑**没做过、且一轮能做完的切片；若 backlog 为空则按 PRD/目标继续推进。' : '',
    '严格输出（不要 markdown 代码块）：',
    '先一行：`RATIONALE: 你这样规划的一句话理由（为什么选这些任务）`',
    '随后每个任务一行，用全角竖线 ｜ 分三段：',
    '`TASK: 任务标题 ｜ 负责角色 ｜ 具体做什么（越具体越好，指明大致改哪里）`',
    '只输出 1 行 RATIONALE + 1–2 行 TASK。不要改任何代码，这一步只做规划。',
  ]
    .filter(Boolean)
    .join('\n')
}

interface PlanTask {
  title: string
  role: string
  brief: string
}
function parsePlan(output: string): PlanTask[] {
  const tasks: PlanTask[] = []
  for (const line of output.split('\n')) {
    const m = line.match(/TASK[:：]\s*(.+)/)
    if (!m) continue
    const cols = m[1].split(/[｜|]/).map((c) => c.replace(/[`*]/g, '').trim())
    if (!cols[0]) continue
    tasks.push({ title: cols[0].slice(0, 80), role: cols[1] || '全栈工程', brief: cols[2] || cols[0] })
  }
  return tasks.slice(0, 3)
}

function codeTaskPrompt(t: PlanTask, branch: string): string {
  return [
    `你在真实代码仓库里工作，当前目录=仓库根。以「${t.role}」的身份完成下面的任务。`,
    '',
    `# 任务：${t.title}`,
    t.brief,
    '',
    '## 执行要求',
    `1. 先切分支：\`git checkout -b ${branch}\`（若存在则 \`git checkout ${branch}\`）。`,
    '2. 读懂相关代码，做**小而完整、可编译**的改动，遵循现有风格；只做本任务范围内的改动。',
    '3. 提交时**只 `git add` 你本次真正改动/新建的具体文件（逐个写路径）**，',
    '   **绝不要 `git add -A` / `git add .`**（仓库里有大量未跟踪的大文件/产物，不能提交）。',
    `   然后 \`git commit -m "feat: ${t.title}"\`。`,
    '4. 不要执行构建/测试。最后简述你改了哪些文件、为什么。',
  ].join('\n')
}

function qaPrompt(t: PlanTask, execOutput: string): string {
  return [
    '你是质量把关人。判断下面这个任务的**执行结果**是否真正满足**任务要求**。',
    '',
    `# 任务：${t.title}`,
    t.brief,
    '',
    '# 执行结果（含代码改动摘要）',
    (execOutput || '').slice(0, 6000),
    '',
    '# 你的判定',
    '第一行必须严格是：`VERDICT: PASS` 或 `VERDICT: FAIL`。随后 1–2 句理由。宁严勿松——不确定就 FAIL。',
  ].join('\n')
}
function qaPass(output: string): boolean {
  return /VERDICT:\s*PASS/i.test(output) && !/VERDICT:\s*FAIL/i.test(output)
}

// env 前奏消毒：脚手架解析可能把 markdown 分隔线（--- / === / ``` / # 等）误当成 env，
// 直接拼进 shell 脚本会让 bash 异常退出。仅保留看起来像 shell 的行（含 =、export、以 . / source 开头）。
const envPrefix = (ws: Workspace) => {
  const clean = (ws.env || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^[-=*_#`~]+$/.test(l) && (/[=]/.test(l) || /^(export|source|\.)\s/.test(l)))
    .join('\n')
  return clean ? clean + '\n' : ''
}

function integrateScript(ws: Workspace, branches: string[]): string {
  const base = ws.branch || 'main'
  return [
    envPrefix(ws) + 'set +e',
    `git stash -u >/dev/null 2>&1 || true`, // 暂存未提交改动，避免切分支被脏工作区挡
    `git checkout "${base}" || { echo "无法切到 ${base}"; exit 1; }`,
    `git branch -D opc/integration 2>/dev/null`,
    `git checkout -b opc/integration || exit 1`,
    `MERGED=""; CONFLICTS=""`,
    `for b in ${branches.join(' ')}; do`,
    `  git rev-parse --verify "$b" >/dev/null 2>&1 || continue`,
    `  if git merge --no-edit "$b" >/dev/null 2>&1; then MERGED="$MERGED $b"; else git merge --abort; CONFLICTS="$CONFLICTS $b"; fi`,
    `done`,
    `echo "已合并:$MERGED"; [ -n "$CONFLICTS" ] && echo "冲突已跳过:$CONFLICTS" || echo "无冲突"`,
  ].join('\n')
}
const shellCmd = (ws: Workspace, cmd: string) => `${envPrefix(ws)}${cmd}`
function releaseScript(ws: Workspace, ver: string): string {
  const base = ws.branch || 'main'
  return [
    envPrefix(ws) + 'set +e',
    `git stash -u >/dev/null 2>&1 || true`, // 暂存未提交改动，避免切分支被脏工作区挡
    `git checkout opc/integration 2>/dev/null || git checkout "${base}"`,
    `echo "===VERSION==="; echo "${ver}"`,
    `echo "===CHANGELOG==="; git log ${base}..HEAD --pretty=format:"- %s (%h)" 2>/dev/null | head -50; echo ""`,
    `echo "===BUILD==="; ${ws.buildCmd || 'true'} 2>&1 | tail -6`,
    `echo "===ARTIFACT==="; ls -t target/*.jar 2>/dev/null | head -1 || echo "(无产物)"`,
    `git tag "${ver}" 2>/dev/null`,
    `echo "===RUN==="; echo '${(ws.runCmd || '').replace(/'/g, '')}'`,
  ].join('\n')
}

// ── job 等待 ────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitJob(id: string, maxMs = 25 * 60_000): Promise<{ ok: boolean; output: string; error: string | null }> {
  const deadline = now() + maxMs
  for (;;) {
    const j = await getJob(id)
    if (!j) return { ok: false, output: '', error: 'job 丢失' }
    if (j.status === 'done') return { ok: true, output: j.output, error: null }
    if (j.status === 'error') return { ok: false, output: j.output, error: j.error }
    if (now() > deadline) return { ok: false, output: j.output, error: '超时' }
    await sleep(4000)
  }
}

// ── 迭代持久化 ──────────────────────────────────────────────
async function saveIter(it: any): Promise<void> {
  it.updated_at = now()
  await q(
    `UPDATE iterations SET round=$2, goal=$3, feedback=$4, status=$5, phase_log=$6, tasks=$7, release_ver=$8, changelog=$9, error=$10, updated_at=$11, review=$12 WHERE id=$1`,
    [it.id, it.round, it.goal, it.feedback, it.status, JSON.stringify(it.phase_log), JSON.stringify(it.tasks), it.release_ver ?? null, it.changelog ?? '', it.error ?? null, it.updated_at, it.review ? JSON.stringify(it.review) : null],
  )
  notifyOrg(it.org_id, 'state')
}
function logPhase(it: any, msg: string) {
  it.phase_log.push({ t: now(), msg })
  console.log(`[autopilot ${it.project_id} r${it.round}] ${msg}`)
}

export async function getIteration(orgId: string, projectId: string): Promise<any | null> {
  return one(`SELECT * FROM iterations WHERE org_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 1`, [orgId, projectId])
}
export const isProjectRunning = (projectId: string) => running.has(projectId)

// ── 人工评审：对 awaiting_review 的迭代给结论 ─────────────────
// approve = 通过发布，本轮收尾；iterate = 据反馈自动跑下一轮（反馈进规划）
export async function reviewIteration(
  orgId: string,
  projectId: string,
  action: 'approve' | 'iterate',
  feedback: string,
  goal?: string,
): Promise<{ ok: boolean; error?: string }> {
  const it = await getIteration(orgId, projectId)
  // 可从 awaiting_review（正常发布）或 error（失败升级）态给结论
  if (!it || !['awaiting_review', 'error'].includes(it.status)) return { ok: false, error: '当前没有待处理的迭代' }
  await q(`UPDATE iterations SET status='done', feedback=$2, updated_at=$3 WHERE id=$1`, [it.id, feedback || it.feedback || '', now()])
  notifyOrg(orgId, 'state')
  if (action === 'approve') return { ok: true }
  // iterate：带反馈开下一轮（沿用原目标或换新目标）
  return runIteration(orgId, projectId, (goal && goal.trim()) || it.goal, feedback || '')
}

// ── 主循环：跑一轮迭代 ───────────────────────────────────────
export async function runIteration(orgId: string, projectId: string, goal: string, feedback: string): Promise<{ ok: boolean; error?: string }> {
  if (running.has(projectId)) return { ok: false, error: '该项目已有迭代在进行' }
  // 读项目 + 工作区
  const projRow = await one<{ raw: any }>(`SELECT raw FROM projects WHERE id=$1 AND org_id=$2`, [projectId, orgId])
  const ws: Workspace | undefined = projRow?.raw?.workspace
  const projectName: string = projRow?.raw?.name ?? '项目'
  if (!ws?.repoPath) return { ok: false, error: '项目未配置工作区（repo）' }
  if (!orgHasExecutor(orgId)) return { ok: false, error: '没有在线执行器' }

  const prev = await getIteration(orgId, projectId)
  const round = (prev?.round ?? 0) + 1
  if (round > MAX_ROUNDS) return { ok: false, error: `已达轮次上限 ${MAX_ROUNDS}，请人工确认后再继续` }
  const id = 'iter_' + randomUUID().slice(0, 10)
  const it: any = { id, org_id: orgId, project_id: projectId, round, goal, feedback: feedback || prev?.feedback || '', status: 'planning', phase_log: [], tasks: [], release_ver: null, changelog: '', error: null, created_at: now(), updated_at: now() }
  await q(
    `INSERT INTO iterations (id, org_id, project_id, round, goal, feedback, status, phase_log, tasks, payload, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'planning','[]','[]',$7,$8,$8)`,
    [id, orgId, projectId, round, goal, it.feedback, JSON.stringify({ ws }), now()],
  )
  running.add(projectId)
  void drive(it, ws, projectName).finally(() => running.delete(projectId))
  return { ok: true }
}

// ── Seam3：发布后自动评审会 ─────────────────────────────────
// 团队（产品/项目/测试）对照 PRD 评审刚发布的测试版，产出下一轮建议（goal+feedback）或建议收尾。
// 复用会议编排（真会议，显示在会议区、人可读转录）。结论存 it.review，供人在发布页一键采纳/收尾/自定义。
const REVIEW_ROLE_PRIORITY = ['产品', '项目', '测试', '质量', 'QA']
async function runReviewMeeting(it: any, ws: Workspace, projectName: string): Promise<void> {
  const bots = await q<{ id: string; name: string; role: string; avatar_seed: string | null }>(
    `SELECT id, name, role, avatar_seed FROM bots WHERE org_id=$1`,
    [it.org_id],
  ).catch(() => [] as any[])
  if (!bots.length) return // 无虚拟成员 → 跳过，转人工评审
  const rank = (role: string) => {
    const i = REVIEW_ROLE_PRIORITY.findIndex((r) => (role || '').includes(r))
    return i < 0 ? 99 : i
  }
  const reviewers = bots.slice().sort((a, b) => rank(a.role) - rank(b.role)).slice(0, 3)

  const spec = await projectSpec(it.project_id)
  const taskList = (it.tasks || []).map((t: any) => `- ${t.title}（${t.status}）`).join('\n')
  const context = [
    `项目：${projectName}`,
    `本轮目标：${it.goal}`,
    `发布版本：${it.release_ver}`,
    it.changelog ? `本轮改动（changelog）：\n${it.changelog}` : '',
    taskList ? `本轮任务：\n${taskList}` : '',
    ws.runCmd ? `本地运行方式：${ws.runCmd}` : '',
    spec,
  ]
    .filter(Boolean)
    .join('\n\n')

  const turns = reviewers.map((b) => ({
    botId: b.id,
    name: b.name,
    role: b.role,
    avatarSeed: b.avatar_seed ?? b.id,
    head:
      `你是「${projectName}」项目的${b.role}「${b.name}」，正在参加对刚发布测试版 ${it.release_ver} 的评审会。\n` +
      `以下是本轮上下文与项目规格：\n\n${context}\n\n已有评审发言：\n`,
    tail:
      `请从你的${b.role}专业视角，简明扼要评审（3–6 句）：\n` +
      `① 本轮目标「${it.goal}」是否达成、交付质量如何；\n` +
      `② 对照 PRD/规格，离 MVP/目标还差哪些关键项；\n` +
      `③ 你建议下一轮优先做什么（具体、可一轮做完）。`,
  }))

  const pm = {
    head: `你是评审会主持人。以下是各成员对测试版 ${it.release_ver}（本轮目标：${it.goal}）的评审发言：\n\n`,
    tail:
      `\n\n请先用 4–8 句中文写一段**评审纪要**（这版交付了什么、达成度、主要问题/共识）。\n` +
      `随后**另起一段**，严格按下列格式输出机器可读结论（每字段占一行，供系统解析）：\n` +
      `===DECISION===\n` +
      `VERDICT: iterate 或 done（PRD/backlog 已基本达成用 done，否则 iterate）\n` +
      `GOAL: 下一轮一句话目标（VERDICT=done 时写「项目达成」）\n` +
      `FEEDBACK: 给下一轮的具体改进/优先事项（综合上面建议，1–3 条）`,
  }

  const meeting = {
    id: `mtg_review_${it.id}`,
    projectId: it.project_id,
    productId: null,
    title: `评审会 · 第${it.round}轮 ${it.release_ver}`,
    agenda: `评审测试版 ${it.release_ver}，决定下一轮方向`,
    participantBotIds: reviewers.map((b) => b.id),
    references: '',
    fullDocSlugs: [],
    createdAt: now(),
    messages: [],
  }
  await orchestrateMeeting(it.org_id, { meeting, rounds: 1, parallel: true, kind: 'review', turns, roundDirectives: [], pm } as any)

  const m = await one<{ output: string }>(`SELECT output FROM meetings WHERE id=$1`, [meeting.id]).catch(() => null)
  const out = m?.output || ''
  const [summary, decBlock = ''] = out.split(/===DECISION===/)
  const grab = (k: string) => (decBlock.match(new RegExp(`${k}\\s*[:：]\\s*(.+)`))?.[1] || '').trim()
  const v = grab('VERDICT').toLowerCase()
  const verdict = /done|达成|收尾/.test(v) ? 'done' : 'iterate'
  it.review = {
    meetingId: meeting.id,
    verdict,
    goal: grab('GOAL') || it.goal,
    feedback: grab('FEEDBACK') || '',
    summary: (summary || '').trim().slice(0, 2000),
    reviewers: reviewers.map((b) => b.name),
    at: now(),
  }
}

async function drive(it: any, ws: Workspace, projectName: string): Promise<void> {
  const mk = (kind: string, prompt: string, extra: any = {}) =>
    createJob({ orgId: it.org_id, kind, prompt, cwd: ws.repoPath, targetMachine: ws.machine ?? null, ...extra })
  try {
    // 1. 规划（带跨轮记忆）
    logPhase(it, '规划本轮任务…')
    await saveIter(it)
    const memory = await projectMemory(it.org_id, it.project_id, it.id)
    const spec = await projectSpec(it.project_id) // 接缝1：注入 PRD + backlog
    if (spec) logPhase(it, '已载入项目规格（PRD/backlog）作为规划依据')
    const planJob = await mk('plan', planPrompt(projectName, it.goal, it.feedback, memory, spec), { refType: 'plan', refId: `plan:${it.id}` })
    const plan = await waitJob(planJob.id)
    if (!plan.ok) throw new Error('规划失败：' + plan.error)
    const rationale = plan.output.match(/RATIONALE[:：]\s*(.+)/)?.[1]?.trim()
    if (rationale) logPhase(it, '规划思路：' + rationale.slice(0, 120))
    const planned = parsePlan(plan.output)
    if (planned.length === 0) throw new Error('规划未产出可执行任务')
    it.tasks = planned.map((t, i) => ({ ...t, branch: `opc/iter${it.round}-${i + 1}`, status: 'executing', execOutput: '', verdict: '' }))
    it.status = 'executing'
    logPhase(it, `规划出 ${it.tasks.length} 个任务：${it.tasks.map((t: any) => t.title).join('、')}`)
    await saveIter(it)

    // 2. 执行（并发派码任务）
    const execJobs = await Promise.all(it.tasks.map((t: any) => mk('task', codeTaskPrompt(t, t.branch), { refType: 'iter', refId: `${it.id}:${t.branch}` })))
    const execResults = await Promise.all(execJobs.map((j) => waitJob(j.id)))
    it.tasks.forEach((t: any, i: number) => {
      t.execOutput = execResults[i].output
      t.status = execResults[i].ok ? 'executed' : 'exec_failed'
    })
    // 失败升级：对失败任务重试一次（G4.2）
    const failedTasks = it.tasks.filter((t: any) => t.status === 'exec_failed')
    if (failedTasks.length) {
      logPhase(it, `${failedTasks.length} 个任务执行失败，重试一次…`)
      await saveIter(it)
      const retryJobs = await Promise.all(failedTasks.map((t: any) => mk('task', codeTaskPrompt(t, t.branch), { refType: 'iter', refId: `${it.id}:${t.branch}:retry` })))
      const retryResults = await Promise.all(retryJobs.map((j) => waitJob(j.id)))
      failedTasks.forEach((t: any, i: number) => {
        if (retryResults[i].ok) { t.execOutput = retryResults[i].output; t.status = 'executed' }
      })
    }
    it.status = 'qa'
    logPhase(it, `执行完成：${it.tasks.filter((t: any) => t.status === 'executed').length}/${it.tasks.length} 成功`)
    await saveIter(it)

    // 3. QA 复核
    const qaTargets = it.tasks.filter((t: any) => t.status === 'executed')
    const qaJobs = await Promise.all(qaTargets.map((t: any) => mk('qa', qaPrompt(t, t.execOutput), { refType: 'iterqa', refId: `qa:${it.id}:${t.branch}` })))
    const qaResults = await Promise.all(qaJobs.map((j) => waitJob(j.id)))
    qaTargets.forEach((t: any, i: number) => {
      t.verdict = qaResults[i].ok && qaPass(qaResults[i].output) ? 'pass' : 'fail'
      t.status = t.verdict === 'pass' ? 'passed' : 'rejected'
    })
    const passed = it.tasks.filter((t: any) => t.status === 'passed')
    it.status = 'integrating'
    logPhase(it, `QA 复核：${passed.length} 通过 / ${qaTargets.length - passed.length} 驳回`)
    await saveIter(it)
    if (passed.length === 0) {
      const reasons = it.tasks.map((t: any) => `「${t.title}」${t.status === 'passed' ? '' : t.status === 'exec_failed' ? '执行失败' : 'QA驳回'}`).join('；')
      throw new Error(`本轮没有任务通过验收，未产出可发布版本。原因：${reasons}。可在评审里给反馈后重试。`)
    }

    // 4. 集成
    const integ = await waitJob((await mk('integrate', integrateScript(ws, passed.map((t: any) => t.branch)), { refType: 'iterstep', refId: `integrate:${it.id}` })).id)
    if (!integ.ok) throw new Error('集成失败：' + integ.error)
    logPhase(it, '集成完成 → opc/integration')

    // 5. 构建 + 测试
    it.status = 'building'; await saveIter(it)
    if (ws.buildCmd) {
      const b = await waitJob((await mk('build', shellCmd(ws, ws.buildCmd), { refType: 'iterstep', refId: `build:${it.id}` })).id)
      if (!b.ok) throw new Error('构建失败：' + (b.error || '').slice(-300))
      logPhase(it, '构建成功')
    }
    it.status = 'testing'; await saveIter(it)
    if (ws.testCmd) {
      const tj = await waitJob((await mk('test', shellCmd(ws, ws.testCmd), { refType: 'iterstep', refId: `test:${it.id}` })).id)
      logPhase(it, tj.ok ? '测试通过' : '⚠️ 测试未过（仍发布，供评审判断）')
    }

    // 6. 发布
    it.status = 'releasing'; await saveIter(it)
    const d = new Date()
    const ver = `v${it.round}-${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    const rel = await waitJob((await mk('release', releaseScript(ws, ver), { refType: 'release', refId: `release:${ver}` })).id)
    if (!rel.ok) throw new Error('发布失败：' + rel.error)
    const clog = (rel.output.match(/===CHANGELOG===\n([\s\S]*?)\n===/)?.[1] ?? '').trim()
    it.release_ver = ver
    it.changelog = clog
    it.review = null // 清掉上一轮遗留（同一 it 对象不会跨轮，但稳妥起见）
    it.status = 'awaiting_review'
    logPhase(it, `✅ 已发布 ${ver}，等待人工 review`)
    await saveIter(it)

    // Seam3：自动开评审会 → 团队对照 PRD 评估、给下一轮建议。失败不影响已发布版本（转人工评审）。
    try {
      logPhase(it, '评审会进行中：团队正对照 PRD 评估这版交付…')
      await saveIter(it)
      await runReviewMeeting(it, ws, projectName)
      if (it.review) logPhase(it, `评审结论：${it.review.verdict === 'done' ? '建议收尾（项目达成）' : '建议下一轮 → ' + it.review.goal}`)
      await saveIter(it)
    } catch (e) {
      logPhase(it, '⚠️ 评审会未完成（可人工评审）：' + (e as Error).message)
      await saveIter(it).catch(() => {})
    }
  } catch (err) {
    it.status = 'error'
    it.error = (err as Error).message
    logPhase(it, '✗ ' + it.error)
    await saveIter(it).catch(() => {})
  }
}
