import { randomUUID } from 'node:crypto'
import { q } from './db.ts'
import { streamTurn } from './meetingRunner.ts'

// ── 项目秘书（Phase 1：只读问答 + 头脑风暴）──────────────────────────────
// 拥有 org 全局视野：每轮把「组织简报 + 近期对话」喂给 claude 作答。转录存 PG，关页面不断。
// 暂不写系统/不调度（无副作用）；写文档、发起会议/自驾等将后续阶段开放。

const now = () => Date.now()
const clip = (s: string, n: number) => (s || '').replace(/\s+$/g, '').slice(0, n)

/** 编译 org 全局简报：项目/产品 + 关键文档(PRD/愿景)正文 + 未完成 backlog + 自驾状态 + 近期会议 */
export async function buildOrgBrief(orgId: string): Promise<string> {
  const projects = await q<{ id: string; name: string; description: string }>(
    `SELECT id, name, description FROM projects WHERE org_id=$1 ORDER BY created_at`, [orgId],
  ).catch(() => [] as any[])
  if (!projects.length) return '（本公司暂无项目）'

  const products = await q<{ id: string; project_id: string; name: string }>(
    `SELECT id, project_id, name FROM products WHERE org_id=$1`, [orgId],
  ).catch(() => [] as any[])
  const docs = await q<{ product_id: string; title: string; type: string; content: string }>(
    `SELECT product_id, title, type, COALESCE(raw->'versions'->-1->>'content','') AS content FROM docs WHERE org_id=$1`, [orgId],
  ).catch(() => [] as any[])
  const tasks = await q<{ product_id: string; title: string; status: string }>(
    `SELECT product_id, title, status FROM tasks WHERE org_id=$1 AND lower(status) IN ('backlog','todo','ready','open','planned','in_progress','review')`, [orgId],
  ).catch(() => [] as any[])
  const iters = await q<{ project_id: string; round: number; status: string; release_ver: string | null; goal: string }>(
    `SELECT DISTINCT ON (project_id) project_id, round, status, release_ver, goal
       FROM iterations WHERE org_id=$1 ORDER BY project_id, updated_at DESC`, [orgId],
  ).catch(() => [] as any[])
  const meetings = await q<{ project_id: string | null; title: string; status: string; kind: string }>(
    `SELECT project_id, title, status, kind FROM meetings WHERE org_id=$1 ORDER BY created_at DESC LIMIT 12`, [orgId],
  ).catch(() => [] as any[])

  const out: string[] = []
  for (const p of projects) {
    const prods = products.filter((x) => x.project_id === p.id)
    const prodIds = new Set(prods.map((x) => x.id))
    out.push(`\n### 项目：${p.name}${p.description ? ` — ${p.description}` : ''}`)
    if (prods.length) out.push(`产品/模块：${prods.map((x) => x.name).join('、')}`)

    const it = iters.find((x) => x.project_id === p.id)
    if (it) out.push(`自驾状态：第${it.round}轮 · ${it.status}${it.release_ver ? ` · 最新发布 ${it.release_ver}` : ''}${it.goal ? ` · 目标「${clip(it.goal, 40)}」` : ''}`)

    const pdocs = docs.filter((d) => prodIds.has(d.product_id))
    if (pdocs.length) out.push(`文档：${pdocs.map((d) => d.title).join('、')}`)
    // 关键文档正文（愿景/PRD）截断纳入，最多 2 篇
    const key = pdocs.filter((d) => d.content.trim() && ['vision', 'prd', 'story'].includes(d.type)).slice(0, 2)
    for (const d of key) out.push(`〔${d.title}〕\n${clip(d.content, 700)}`)

    const ptasks = tasks.filter((t) => prodIds.has(t.product_id))
    if (ptasks.length) out.push(`未完成待办(${ptasks.length})：${ptasks.slice(0, 12).map((t) => `${t.title}[${t.status}]`).join('；')}`)
  }
  if (meetings.length) out.push(`\n### 近期会议\n${meetings.map((m) => `- ${m.title}（${m.status}）`).join('\n')}`)
  return out.join('\n')
}

const SECRETARY_SYSTEM = [
  '你是这家公司的「项目秘书」，拥有全局视野，是老板与虚拟团队之间的桥梁。',
  '职责：解答项目问题、陪老板头脑风暴、把想法整理成文档、代老板派活。',
  '',
  '## 回复风格（重要）',
  '- 默认极简，像当面向老板口头汇报：先给结论/建议，再最多 2–4 句支撑。能一句话说清就一句话。',
  '- 口语化、可被朗读（将来会用语音/视频呈现）：少用 markdown 标题和长列表，别堆术语与符号。',
  '- 信息确实多时用「两段式」：先写简短口头版；若仍需展开，另起一段以独占一行的 `===DETAIL===` 开头写详细版（老板可选择性展开）。简短版必须自身成立，不看详细版也能懂。',
  '- 给判断和下一步建议，不啰嗦；不确定就说不确定，简报里没有的不要编造。',
  '',
  '## 沉淀文档的能力（提议→老板确认后写入）',
  '当老板想把讨论/想法沉淀成文档时（明确说「整理成文档/写成 PRD/记下来/出个方案」等），在你本轮回复的**最后**追加一个文档草案块——前面照常写你的对话总结。格式严格如下：',
  '===DOC===',
  'TITLE: <简洁标题>',
  'TYPE: <从 vision|prd|story|arch|api|data|design|adr|test|release 里选最贴切的一个>',
  'PRODUCT: <从【组织简报】列出的产品/模块名里选一个最合适的目标；拿不准就选最相关的>',
  '===CONTENT===',
  '<完整 markdown 正文，结构清晰、可直接作为正式文档，不要再解释>',
  '===END===',
  '规则：只有确有沉淀价值、或老板明确要文档时才附；普通问答/闲聊不要附。一次最多一个草案块。你只负责「提议」，实际写入由老板在卡片上点确认——所以不要说“我已写入”，而说“草案在下面，确认即写入”。',
  '',
  '## 调度动作能力（提议→老板确认后执行）',
  '当老板明确要「派活/开干」时，在回复最后追加动作块（可多个，每个用一对标记）。只在确需执行时用，讨论/答疑不要用。你只提议，执行由老板点卡片确认——说“动作卡在下面，确认即执行”，不要说“我已安排”。',
  '① 给某产品加一条 backlog 待办：',
  '===ACTION===',
  'KIND: backlog_add',
  'PROJECT: <项目名>',
  'PRODUCT: <目标产品/模块名，取自组织简报>',
  'TITLE: <任务标题>',
  'BRIEF: <一句话说明要做什么、验收点>',
  'PRIORITY: <high|medium|low>',
  '===END_ACTION===',
  '② 让某项目自驾跑一轮（该项目需已接工作区/repo，否则别提议）：',
  '===ACTION===',
  'KIND: autopilot_run',
  'PROJECT: <项目名>',
  'GOAL: <本轮一句话目标>',
  'FEEDBACK: <可选，给规划的额外提示；没有就留空>',
  '===END_ACTION===',
].join('\n')

/** 取近期转录（时间正序，最多 limit 条） */
async function recentTranscript(orgId: string, limit = 16): Promise<{ role: string; content: string }[]> {
  const rows = await q<{ role: string; content: string }>(
    `SELECT role, content FROM (SELECT role, content, created_at FROM secretary_messages WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2) t ORDER BY created_at ASC`,
    [orgId, limit],
  ).catch(() => [] as any[])
  return rows
}

export async function getSecretaryTranscript(orgId: string): Promise<{ id: string; role: string; content: string; created_at: number }[]> {
  return q(`SELECT id, role, content, created_at FROM secretary_messages WHERE org_id=$1 ORDER BY created_at ASC`, [orgId]).catch(() => [])
}

async function insertMsg(orgId: string, role: string, content: string): Promise<void> {
  await q(`INSERT INTO secretary_messages (id, org_id, role, content, created_at) VALUES ($1,$2,$3,$4,$5)`,
    ['sm_' + randomUUID().slice(0, 10), orgId, role, content, now()])
}

/** 一轮对话：存用户消息 → 组装(system+简报+近期转录+新消息)派 claude → 存并返回回复 */
export async function secretaryChat(orgId: string, message: string): Promise<{ reply: string }> {
  const msg = (message || '').trim()
  if (!msg) throw new Error('消息为空')
  await insertMsg(orgId, 'user', msg)

  const [brief, prior] = await Promise.all([buildOrgBrief(orgId), recentTranscript(orgId, 16)])
  const history = prior.slice(0, -1) // 去掉刚插入的这条（下面单独作为"本轮"）
  const prompt = [
    SECRETARY_SYSTEM,
    '\n===【组织简报】===\n' + brief,
    history.length ? '\n===【近期对话】===\n' + history.map((m) => `${m.role === 'user' ? '老板' : '秘书'}：${m.content}`).join('\n') : '',
    `\n===【本轮】===\n老板：${msg}\n秘书：`,
  ].filter(Boolean).join('\n')

  let reply = ''
  try {
    reply = await streamTurn(orgId, prompt, () => {})
  } catch (e) {
    reply = '（暂时无法应答：' + (e as Error).message + '。请确认有在线执行器后重试。）'
  }
  reply = reply.trim() || '（无输出）'
  await insertMsg(orgId, 'assistant', reply)
  return { reply }
}
