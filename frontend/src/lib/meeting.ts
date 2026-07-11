import type { Bot, Meeting, MeetingKind, MeetingMessage, Product, Requirement, Task, WikiDoc } from '../types'
import { assembleSystemPrompt } from './botCharter'
import { DOC_TYPE } from './ui'

export const MEETING_KIND: Record<MeetingKind, { label: string; hint: string }> = {
  kickoff: { label: '项目立项', hint: '对新项目/新产品立项，明确目标、范围、分工与计划' },
  change: { label: '需求变更', hint: '对已有项目的需求变更做评估、影响分析与重排计划' },
  standup: { label: '例会同步', hint: '同步进展、对齐优先级、暴露阻塞与风险' },
}

const REQ_STATUS: Record<string, string> = { draft: '草稿', planning: '规划中', active: '进行中', done: '已完成' }

/**
 * 项目级知识库：覆盖项目下全部产品的信息/需求/文档/任务，作为会议完整背景。
 * 聚焦产品（focusProductId）的核心文档给正文摘要，其余产品/文档给标题。受字数预算约束。
 */
export function buildProjectKnowledge(input: {
  projectName: string
  projectDesc: string
  products: Product[]
  requirements: Requirement[]
  docs: WikiDoc[]
  tasks: Task[]
  focusProductId: string | null
  references?: string
  fullDocSlugs?: string[]
  maxChars?: number
}): string {
  const { projectName, projectDesc, products, requirements, docs, tasks, focusProductId, references = '', fullDocSlugs = [], maxChars = 30000 } = input

  const parts: string[] = [`## 背景知识库 · 项目「${projectName}」`]
  if (projectDesc) parts.push(projectDesc)
  if (products.length) parts.push(`本项目共 ${products.length} 个产品：${products.map((p) => p.name).join('、')}`)

  // 主持人补充的背景资料（用户手工录入，不截断）
  if (references.trim()) parts.push(`\n## 主持人补充的背景资料\n${references.trim()}`)

  // 全文纳入的文档（每篇最多 8000 字）
  const fullSet = new Set(fullDocSlugs)
  const fullDocs = docs.filter((d) => fullSet.has(d.slug))
  if (fullDocs.length) {
    parts.push(`\n## 完整纳入的文档（${fullDocs.length}）`)
    for (const d of fullDocs) {
      const content = (d.versions[0]?.content ?? '').trim()
      const capped = content.slice(0, 8000)
      parts.push(`\n### ${d.title}（${DOC_TYPE[d.type]?.label ?? d.type}）\n${capped}${content.length > 8000 ? '\n…（文档过长已截断）' : ''}`)
    }
  }

  if (products.length === 0) return parts.join('\n')
  parts.push(`\n## 各产品概况`)

  // 聚焦产品排最前
  const ordered = [...products].sort((a, b) => Number(b.id === focusProductId) - Number(a.id === focusProductId))
  for (const p of ordered) {
    const focus = p.id === focusProductId
    parts.push(`\n---\n### 产品：${p.name}（${p.currentVersion}）${focus ? ' 〔本次会议聚焦〕' : ''}`)
    if (p.description) parts.push(p.description)

    const reqs = requirements.filter((r) => r.productId === p.id)
    if (reqs.length) {
      parts.push(`需求（${reqs.length}）：`)
      for (const r of reqs) parts.push(`- 【${REQ_STATUS[r.status] ?? r.status}】${r.title}${r.description ? '：' + r.description : ''}`)
    }

    const ptasks = tasks.filter((t) => t.productId === p.id)
    if (ptasks.length) {
      const by = (s: string) => ptasks.filter((t) => t.status === s).length
      parts.push(`任务：共 ${ptasks.length} · 完成 ${by('done')} · 进行中 ${by('in_progress')} · 待办 ${by('backlog')}`)
    }

    const pdocs = docs.filter((d) => d.productId === p.id)
    if (pdocs.length) {
      parts.push(`文档（${pdocs.length}）：`)
      const dordered = [...pdocs].sort((a, b) => Number(DOC_TYPE[b.type]?.core ?? false) - Number(DOC_TYPE[a.type]?.core ?? false))
      for (const d of dordered) {
        const label = DOC_TYPE[d.type]?.label ?? d.type
        if (fullSet.has(d.slug)) {
          parts.push(`- ${d.title}（${label}）〔已全文纳入上文〕`)
          continue
        }
        const content = (d.versions[0]?.content ?? '').trim()
        const used = parts.join('\n').length
        // 核心文档给正文摘要（有聚焦时仅聚焦产品；无聚焦时全部产品），预算内；其余仅标题
        const excerptWorthy = DOC_TYPE[d.type]?.core && content && used < maxChars - 900 && (focusProductId === null || focus)
        if (excerptWorthy) {
          parts.push(`#### ${d.title}（${label}）\n${content.slice(0, 480)}${content.length > 480 ? '…' : ''}`)
        } else {
          parts.push(`- ${d.title}（${label}）`)
        }
      }
    }
  }

  let out = parts.join('\n')
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…（背景资料过长，已截断）'
  return out
}

/** 从产品经理输出的「执行计划」段解析出候选任务（列表/编号项） */
export function parseMeetingPlan(output: string): { title: string; detail: string }[] {
  if (!output) return []
  const lines = output.split('\n')
  const items: { title: string; detail: string }[] = []
  const pick = (from: string[]) => {
    for (const raw of from) {
      const m = raw.trim().match(/^([-*]|\d+[.、])\s+(.+)$/)
      if (m) {
        const text = m[2].replace(/\*\*/g, '').replace(/`/g, '').trim()
        if (text.length > 2) items.push({ title: text.slice(0, 60), detail: text })
      }
    }
  }
  // 先取「执行计划」段
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (start < 0 && /^#{1,4}.*执行计划/.test(l)) start = i + 1
    else if (start >= 0 && /^#{1,4}.*(会议纪要|纪要)/.test(l)) {
      end = i
      break
    }
  }
  if (start >= 0) pick(lines.slice(start, end))
  // 退回：整篇的列表项
  if (items.length === 0) pick(lines)
  return items.slice(0, 30)
}

function transcript(messages: MeetingMessage[]): string {
  if (messages.length === 0) return '（暂无发言）'
  return messages
    .filter((m) => m.content.trim())
    .map((m) => `【${m.speakerName}${m.speakerRole ? ' · ' + m.speakerRole : ''}】\n${m.content.trim()}`)
    .join('\n\n')
}

function context(meeting: Meeting, product: Product | null): string {
  return [
    `# 会议：${meeting.title}（${MEETING_KIND[meeting.kind].label}）`,
    product ? `所属产品：${product.name}（${product.currentVersion}）` : '（未选择产品）',
    `会议目的：${MEETING_KIND[meeting.kind].hint}`,
    `议题 / 背景：\n${meeting.agenda || '（见标题）'}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 某个虚拟人力在会议上的发言 prompt（plan 模式） */
export function botTurnPrompt(
  bot: Bot,
  meeting: Meeting,
  priorMessages: MeetingMessage[],
  product: Product | null,
  knowledge: string,
): string {
  return [
    assembleSystemPrompt(bot),
    '',
    '---',
    '',
    context(meeting, product),
    '',
    knowledge,
    '',
    '## 已有发言',
    transcript(priorMessages),
    '',
    '## 你的发言',
    `你正在参加这个会议。请**结合上面的背景知识库**（产品现状、需求、文档、任务），以${bot.role}的视角针对议题发表专业意见：关注点、风险、建议，以及你负责部分的初步计划。`,
    `要具体、扣住产品实际情况，不要泛泛而谈。以「计划模式」思考——只讨论与规划，不执行任何改动。控制在 250–450 字，直接给内容、不要寒暄。`,
  ].join('\n')
}

/** 产品经理会后整理 prompt：输出执行计划 + 会议纪要 */
export function pmConsolidatePrompt(
  pm: Bot,
  meeting: Meeting,
  allMessages: MeetingMessage[],
  product: Product | null,
  knowledge: string,
): string {
  return [
    assembleSystemPrompt(pm),
    '',
    '---',
    '',
    '# 会后整理任务',
    `你是本次会议的产品经理，负责会后整理输出，指导后续工作。`,
    '',
    context(meeting, product),
    '',
    knowledge,
    '',
    '## 完整会议记录',
    transcript(allMessages),
    '',
    '## 你的输出（Markdown 格式，详细、可落地，紧扣产品实际情况）',
    '严格按以下两部分输出：',
    '',
    '## 一、执行计划',
    '分阶段、分角色的可执行任务清单。每项包含：负责角色、任务、产出物、验收要点、依赖。尽量对应到参会角色与产品现有需求/文档。',
    '',
    '## 二、会议纪要',
    '详细展开：① 背景与目标 ② 各角色关键意见汇总 ③ 达成的决策 ④ 遗留问题与风险 ⑤ 后续行动项（谁、做什么、何时）。',
  ].join('\n')
}
