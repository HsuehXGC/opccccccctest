import type { Bot, DocType, Meeting, MeetingKind, MeetingMessage, Product, Requirement, Task, WikiDoc } from '../types'
import { assembleSystemPrompt } from './botCharter'
import { DOC_TYPE, DOC_TYPE_ORDER } from './ui'

export const MEETING_KIND: Record<MeetingKind, { label: string; hint: string }> = {
  kickoff: { label: '项目立项', hint: '对新项目/新产品立项，明确目标、范围、分工与计划' },
  change: { label: '需求变更', hint: '对已有项目的需求变更做评估、影响分析与重排计划' },
  standup: { label: '例会同步', hint: '同步进展、对齐优先级、暴露阻塞与风险' },
  docgen: { label: '文档撰写', hint: '基于已完成任务的产出，商定要写哪些项目文档、各自负责，随后逐篇撰写正式文档' },
  review: { label: '发布评审', hint: '自驾发布测试版后，团队对照 PRD 评估交付、给出下一轮建议（由 OPC 自动发起）' },
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
  /** 纳入已完成任务的产出（文档撰写会用它作为素材） */
  includeTaskOutputs?: boolean
  maxChars?: number
}): string {
  const { projectName, projectDesc, products, requirements, docs, tasks, focusProductId, references = '', fullDocSlugs = [], includeTaskOutputs = false, maxChars = 30000 } = input

  const parts: string[] = [`## 背景知识库 · 项目「${projectName}」`]
  if (projectDesc) parts.push(projectDesc)
  if (products.length) parts.push(`本项目共 ${products.length} 个产品：${products.map((p) => p.name).join('、')}`)

  // 主持人补充的背景资料（用户手工录入，不截断）
  if (references.trim()) parts.push(`\n## 主持人补充的背景资料\n${references.trim()}`)

  // 已完成任务的产出（文档撰写会的素材来源）
  if (includeTaskOutputs) {
    const doneWithOutput = tasks.filter((t) => t.output && t.output.trim())
    if (doneWithOutput.length) {
      parts.push(`\n## 已完成任务的产出（${doneWithOutput.length} 项，撰写文档的一手素材）`)
      const budget = Math.floor((maxChars * 0.6) / doneWithOutput.length)
      for (const t of doneWithOutput) {
        const body = (t.output ?? '').trim()
        parts.push(`\n### 任务：${t.title}\n${body.slice(0, Math.max(600, budget))}${body.length > Math.max(600, budget) ? '\n…（产出过长已截断）' : ''}`)
      }
    }
  }

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

/** 第 2 轮及以后的追加指令：看到他人发言后反应/收敛/抛分歧 */
const roundDirective = (round: number) =>
  [
    '',
    `## 第 ${round} 轮讨论`,
    '你在上一轮已经发过言，现在能看到其他角色这一轮之前的发言（见上「已有发言」）。请：',
    '① 明确指出你**同意**谁的哪一点、**不同意**谁的哪一点（点名到角色）；',
    '② 据此**更新或收敛**你的立场，或抛出需要拍板的分歧；',
    '③ 只说增量，**不要重复上一轮**。控制在 150–320 字，直接给内容。',
  ].join('\n')

/** 某个虚拟人力在会议上的发言 prompt（plan 模式）。round≥2 时追加多轮反应指令 */
export function botTurnPrompt(
  bot: Bot,
  meeting: Meeting,
  priorMessages: MeetingMessage[],
  product: Product | null,
  knowledge: string,
  round = 1,
): string {
  const base = [
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
  ]
  if (round >= 2) {
    base.push(roundDirective(round))
    return base.join('\n')
  }
  base.push(
    '',
    '## 你的发言',
    `你正在参加这个会议。请**结合上面的背景知识库**（产品现状、需求、文档、任务），以${bot.role}的视角针对议题发表专业意见：关注点、风险、建议，以及你负责部分的初步计划。`,
    `要具体、扣住产品实际情况，不要泛泛而谈。以「计划模式」思考——只讨论与规划，不执行任何改动。控制在 250–450 字，直接给内容、不要寒暄。`,
  )
  return base.join('\n')
}

// ── 供云端编排：把发言 prompt 拆成 head（到「## 已有发言」）+ tail（收尾） ──
// 后端按 head + transcript(已有发言) + tail 拼接，逻辑单一来源在本文件。
export function turnHead(bot: Bot, meeting: Meeting, product: Product | null, knowledge: string): string {
  return [assembleSystemPrompt(bot), '', '---', '', context(meeting, product), '', knowledge, '', '## 已有发言', ''].join('\n')
}
export function turnTail(bot: Bot): string {
  return [
    '',
    '## 你的发言',
    `你正在参加这个会议。请**结合上面的背景知识库**（产品现状、需求、文档、任务），以${bot.role}的视角针对议题发表专业意见：关注点、风险、建议，以及你负责部分的初步计划。`,
    `要具体、扣住产品实际情况，不要泛泛而谈。以「计划模式」思考——只讨论与规划，不执行任何改动。控制在 250–450 字，直接给内容、不要寒暄。`,
  ].join('\n')
}
export const roundDirectiveText = (round: number) => roundDirective(round)

// ── 文档撰写会 ─────────────────────────────────────────────
/** 标签→DocType 反查（用于解析清单里的「类型」） */
const DOC_LABEL_TO_TYPE: Record<string, DocType> = Object.fromEntries(
  (Object.entries(DOC_TYPE) as [DocType, { label: string }][]).map(([k, v]) => [v.label, k]),
) as Record<string, DocType>

export interface DocManifestItem {
  title: string
  type: DocType
  ownerRole: string
  brief: string
}

/** 产品经理据讨论产出《文档撰写清单》——每篇：标题｜类型｜负责角色｜要点 */
export function docManifestPrompt(pm: Bot, meeting: Meeting, allMessages: MeetingMessage[], product: Product | null, knowledge: string): string {
  const types = DOC_TYPE_ORDER.map((t) => DOC_TYPE[t].label).join('、')
  return [
    assembleSystemPrompt(pm),
    '',
    '---',
    '',
    '# 会后整理任务：拟定《文档撰写清单》',
    '你是本次「文档撰写会」的产品经理。基于上面的背景（尤其「已完成任务的产出」）与下方讨论，列出本项目现在应当撰写的**全部正式项目文档**，并分派到负责角色。',
    '',
    context(meeting, product),
    '',
    knowledge,
    '',
    '## 完整讨论记录',
    transcript(allMessages),
    '',
    '## 你的输出（严格格式，供系统解析）',
    '先写一行「## 文档清单」，随后**每篇文档一行**，严格用以下格式（用全角竖线 ｜ 分隔四段，不要加表格）：',
    '`- 文档标题 ｜ 类型 ｜ 负责角色 ｜ 一句话要点（这篇要覆盖什么）`',
    `其中「类型」只能从这些里选一个：${types}。`,
    '「负责角色」从参会角色里选最合适的一个。覆盖项目需要的各类文档（愿景/需求/架构/接口/数据/设计/测试/发布等按需），不要遗漏，也不要为凑数硬造。',
    '清单之后可另起「## 说明」简述取舍，但清单行必须严格如上格式。',
  ].join('\n')
}

/** 解析《文档撰写清单》为结构化条目 */
export function parseDocManifest(output: string): DocManifestItem[] {
  if (!output) return []
  const items: DocManifestItem[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    const m = line.match(/^([-*]|\d+[.、])\s+(.+)$/)
    if (!m) continue
    const cols = m[2].split(/[｜|]/).map((c) => c.replace(/\*\*/g, '').replace(/`/g, '').trim())
    if (cols.length < 3 || !cols[0]) continue
    const [title, typeLabel, ownerRole, ...rest] = cols
    items.push({
      title: title.slice(0, 80),
      type: DOC_LABEL_TO_TYPE[typeLabel] ?? 'prd',
      ownerRole: ownerRole || '产品经理',
      brief: (rest.join(' ') || '').slice(0, 200),
    })
  }
  return items.slice(0, 20)
}

/** 某角色撰写一篇完整文档的 prompt */
export function docAuthorPrompt(bot: Bot, meeting: Meeting, product: Product | null, knowledge: string, item: DocManifestItem): string {
  const typeLabel = DOC_TYPE[item.type]?.label ?? item.type
  return [
    assembleSystemPrompt(bot),
    '',
    '---',
    '',
    context(meeting, product),
    '',
    knowledge,
    '',
    `## 撰写任务：${item.title}（${typeLabel}）`,
    `你负责撰写这篇「${typeLabel}」文档。要点：${item.brief || '（见标题）'}`,
    '要求：',
    '- **直接输出完整文档正文**（Markdown），不要寒暄、不要复述任务、不要写"以下是…"。',
    '- 紧扣上面的背景知识库与「已完成任务的产出」，用项目真实信息，不要泛泛而谈、不要占位符。',
    `- 结构专业、可交付：符合「${typeLabel}」这类文档应有的章节与深度。`,
    '- 以「计划/文档」形态产出，只写文档内容本身，不执行任何代码或改动。',
    '- 首行用 `# 标题` 开头。',
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

/** PM 整理 prompt 的 head（到「完整会议/讨论记录」）+ tail（输出要求）——供云端编排拼接 */
export function pmHead(pm: Bot, meeting: Meeting, product: Product | null, knowledge: string, kind: MeetingKind): string {
  if (kind === 'docgen') {
    return [
      assembleSystemPrompt(pm), '', '---', '',
      '# 会后整理任务：拟定《文档撰写清单》',
      '你是本次「文档撰写会」的产品经理。基于上面的背景（尤其「已完成任务的产出」）与下方讨论，列出本项目现在应当撰写的**全部正式项目文档**，并分派到负责角色。',
      '', context(meeting, product), '', knowledge, '',
      '## 完整讨论记录', '',
    ].join('\n')
  }
  return [
    assembleSystemPrompt(pm), '', '---', '',
    '# 会后整理任务',
    `你是本次会议的产品经理，负责会后整理输出，指导后续工作。`,
    '', context(meeting, product), '', knowledge, '',
    '## 完整会议记录', '',
  ].join('\n')
}
export function pmTail(kind: MeetingKind): string {
  if (kind === 'docgen') {
    const types = DOC_TYPE_ORDER.map((t) => DOC_TYPE[t].label).join('、')
    return [
      '', '## 你的输出（严格格式，供系统解析）',
      '先写一行「## 文档清单」，随后**每篇文档一行**，严格用以下格式（用全角竖线 ｜ 分隔四段，不要加表格）：',
      '`- 文档标题 ｜ 类型 ｜ 负责角色 ｜ 一句话要点（这篇要覆盖什么）`',
      `其中「类型」只能从这些里选一个：${types}。`,
      '「负责角色」从参会角色里选最合适的一个。覆盖项目需要的各类文档（愿景/需求/架构/接口/数据/设计/测试/发布等按需），不要遗漏，也不要为凑数硬造。',
      '清单之后可另起「## 说明」简述取舍，但清单行必须严格如上格式。',
    ].join('\n')
  }
  return [
    '', '## 你的输出（Markdown 格式，详细、可落地，紧扣产品实际情况）',
    '严格按以下两部分输出：', '',
    '## 一、执行计划',
    '分阶段、分角色的可执行任务清单。每项包含：负责角色、任务、产出物、验收要点、依赖。尽量对应到参会角色与产品现有需求/文档。', '',
    '## 二、会议纪要',
    '详细展开：① 背景与目标 ② 各角色关键意见汇总 ③ 达成的决策 ④ 遗留问题与风险 ⑤ 后续行动项（谁、做什么、何时）。',
  ].join('\n')
}
