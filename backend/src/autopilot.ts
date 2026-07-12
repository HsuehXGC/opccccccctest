import { randomUUID } from 'node:crypto'
import { q, one } from './db.ts'
import { createJob, getJob } from './jobStore.ts'
import { orgHasExecutor } from './meetingRunner.ts'
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

// ── 提示词（后端自持，不依赖浏览器）──────────────────────────
function planPrompt(projectName: string, goal: string, feedback: string, memory: string): string {
  return [
    `你是「${projectName}」的技术负责人，正在真实代码仓库里工作（当前目录=仓库根）。`,
    `本轮目标：${goal}`,
    feedback ? `上一轮发布后的人工评审反馈（务必据此调整）：${feedback}` : '',
    memory,
    '',
    '请先快速浏览现有代码结构，然后规划**本轮 1–2 个小而具体、低风险、可独立实现并提交**的任务，朝目标推进。',
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

const envPrefix = (ws: Workspace) => (ws.env ? ws.env + '\n' : '')

function integrateScript(ws: Workspace, branches: string[]): string {
  const base = ws.branch || 'main'
  return [
    envPrefix(ws) + 'set +e',
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
    `UPDATE iterations SET round=$2, goal=$3, feedback=$4, status=$5, phase_log=$6, tasks=$7, release_ver=$8, changelog=$9, error=$10, updated_at=$11 WHERE id=$1`,
    [it.id, it.round, it.goal, it.feedback, it.status, JSON.stringify(it.phase_log), JSON.stringify(it.tasks), it.release_ver ?? null, it.changelog ?? '', it.error ?? null, it.updated_at],
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

async function drive(it: any, ws: Workspace, projectName: string): Promise<void> {
  const mk = (kind: string, prompt: string, extra: any = {}) =>
    createJob({ orgId: it.org_id, kind, prompt, cwd: ws.repoPath, targetMachine: ws.machine ?? null, ...extra })
  try {
    // 1. 规划（带跨轮记忆）
    logPhase(it, '规划本轮任务…')
    await saveIter(it)
    const memory = await projectMemory(it.org_id, it.project_id, it.id)
    const planJob = await mk('plan', planPrompt(projectName, it.goal, it.feedback, memory), { refType: 'plan', refId: `plan:${it.id}` })
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
    it.status = 'awaiting_review'
    logPhase(it, `✅ 已发布 ${ver}，等待人工 review`)
    await saveIter(it)
  } catch (err) {
    it.status = 'error'
    it.error = (err as Error).message
    logPhase(it, '✗ ' + it.error)
    await saveIter(it).catch(() => {})
  }
}
