import type { Bot, BotRole, Task } from '../types'

// ── AI / 启发式 任务分派 ───────────────────────────────────
// 给「待分派任务」按角色/技能匹配到最合适的虚拟员工。
// 主路径：一次 claude 调用批量分派；回退：关键词→角色启发式（离线也可用）。

/** 关键词 → 角色 的启发式规则（按优先级从上到下命中） */
const ROLE_RULES: { role: BotRole; kw: RegExp }[] = [
  { role: '测试', kw: /测试|用例|QA|验收|回归|冒烟|质量/i },
  { role: '前端', kw: /前端|页面|组件|UI|样式|交互|响应式|Tailwind|React|落地页布局/i },
  { role: '后端', kw: /后端|接口|API|服务端|数据库|鉴权|中间件|webhook|限流|schema/i },
  { role: '数据分析', kw: /数据|爬取|采集|分析|指标|看板|统计|清洗|口径/i },
  { role: '文案运营', kw: /文案|落地页文案|营销|SEO|社媒|说明|免责|命名|品牌|内容/i },
  { role: '全栈工程', kw: /架构|全栈|骨架|脚手架|部署|CI|集成|打通|端到端/i },
  { role: '项目经理', kw: /排期|里程碑|依赖|计划|WBS|甘特|风险登记|协调/i },
  { role: '产品经理', kw: /需求|PRD|范围|路线图|用户故事|优先级|愿景|规格/i },
]

/** 单个任务的启发式角色判定 */
export function roleForTask(task: Task): BotRole {
  const text = `${task.title} ${task.brief ?? ''} ${task.description ?? ''}`
  for (const r of ROLE_RULES) if (r.kw.test(text)) return r.role
  return '全栈工程'
}

/** 在候选 bots 里为某角色挑一个（优先同角色，其次全栈/产品经理兜底） */
export function botForRole(role: BotRole, bots: Bot[]): Bot | undefined {
  return (
    bots.find((b) => b.role === role) ||
    bots.find((b) => b.role === '全栈工程') ||
    bots.find((b) => b.role === '产品经理') ||
    bots[0]
  )
}

/** 启发式：一次性给一批任务分派（离线兜底） */
export function heuristicAssign(tasks: Task[], bots: Bot[]): { taskId: string; botId: string }[] {
  const out: { taskId: string; botId: string }[] = []
  for (const t of tasks) {
    const bot = botForRole(roleForTask(t), bots)
    if (bot) out.push({ taskId: t.id, botId: bot.id })
  }
  return out
}

/** 批量分派 prompt：让模型为每个任务选一位员工，严格输出「任务号 -> 员工号」 */
export function assignPrompt(tasks: Task[], bots: Bot[]): string {
  const roster = bots.map((b, i) => `[${i + 1}] ${b.name} · ${b.role}`).join('\n')
  const list = tasks
    .map((t, i) => {
      const brief = (t.brief || t.description || '').replace(/\s+/g, ' ').slice(0, 160)
      return `[${i + 1}] ${t.title}${brief ? ` —— ${brief}` : ''}`
    })
    .join('\n')
  return [
    '你是任务分派协调员。为下面每个任务，从可选虚拟员工里选出**最合适的一位负责人**——按角色与任务性质匹配（前端做界面、后端做接口、数据做分析、测试做用例、文案做内容、全栈做架构/打通、产品经理做需求规格、项目经理做排期依赖）。',
    '',
    '## 可选虚拟员工',
    roster,
    '',
    '## 待分派任务',
    list,
    '',
    '## 输出（严格格式，只输出这些行，每行一个任务，不要解释、不要表格）',
    '`任务序号 -> 员工序号`',
    '例如：`1 -> 3`',
  ].join('\n')
}

/** 解析「任务号 -> 员工号」为 {taskId, botId} 列表 */
export function parseAssignments(output: string, tasks: Task[], bots: Bot[]): { taskId: string; botId: string }[] {
  const out: { taskId: string; botId: string }[] = []
  const seen = new Set<string>()
  for (const raw of output.split('\n')) {
    const m = raw.match(/(\d+)\s*->\s*(\d+)/)
    if (!m) continue
    const ti = Number(m[1]) - 1
    const bi = Number(m[2]) - 1
    const task = tasks[ti]
    const bot = bots[bi]
    if (task && bot && !seen.has(task.id)) {
      out.push({ taskId: task.id, botId: bot.id })
      seen.add(task.id)
    }
  }
  return out
}
