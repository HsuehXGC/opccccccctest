import type { DocType, Product, Requirement, TaskKind, WikiDoc } from '../types'
import { DOC_TYPE, DOC_TYPE_ORDER } from './ui'

// ── 智能拆解规划器 ────────────────────────────────────────
// 「规划机器人」的前端雏形：读需求正文 + 产品文档蓝图缺口，产出一组
// 带 brief（= 将来 claude -p 的输入）的文档/执行任务，并为每个缺口补一份占位草稿。
// 纯函数、确定性 —— 供工作台先「预览」再「生成」，两次结果一致。

const CORE_TYPES = DOC_TYPE_ORDER.filter((t) => DOC_TYPE[t].core)

/** 缺口核心文档对应的建议员工角色（用于 brief 口吻） */
const ROLE_FOR: Partial<Record<DocType, string>> = {
  prd: '产品',
  arch: '后端架构',
  api: '后端',
  test: '测试',
}

export interface PlannedDoc {
  slug: string
  title: string
  type: DocType
}

export interface PlannedTask {
  kind: TaskKind
  title: string
  description: string
  brief: string
  targetDocSlug: string | null
}

export interface DecomposePlan {
  gapDocs: PlannedDoc[]
  tasks: PlannedTask[]
}

const productKey = (product: Product | null) => (product ? product.id.replace(/^product-/, '') : 'x')

function docBrief(req: Requirement, product: Product | null, label: string, role: string): string {
  return [
    `你是负责「${product?.name ?? '该产品'}」的${role}员工。请基于需求「${req.title}」起草《${label}》。`,
    ``,
    `需求摘要：${req.description || '（见需求正文）'}`,
    ``,
    `产出要求：`,
    `- 覆盖《${label}》应有的标准结构与关键内容`,
    `- 与需求保持一致，可用 [[slug]] 关联相关产品文档`,
    ``,
    `验收标准：`,
    `- 结构完整、口径统一、可进入评审`,
  ].join('\n')
}

function workBrief(req: Requirement, product: Product | null): string {
  return [
    `你是负责「${product?.name ?? '该产品'}」的全栈工程员工。请落地实现需求「${req.title}」。`,
    ``,
    `需求摘要：${req.description || '（见需求正文）'}`,
    ``,
    `执行要求：`,
    `- 按已定稿的 PRD / 架构 / 接口契约实现`,
    `- 自测通过，产出可交付成果`,
    ``,
    `验收标准：`,
    `- 功能符合需求、通过基本验证`,
  ].join('\n')
}

/**
 * 生成拆解方案：
 * - 每个缺失的核心文档 → 一份占位草稿（gapDocs） + 一个文档任务（交付目标指向该草稿）
 * - 外加一个落地实现的执行任务
 */
export function planDecomposition(req: Requirement, product: Product | null, docs: WikiDoc[]): DecomposePlan {
  const productDocs = docs.filter((d) => d.productId === product?.id)
  const presentTypes = new Set(productDocs.map((d) => d.type))
  const gaps = CORE_TYPES.filter((t) => !presentTypes.has(t))

  const gapDocs: PlannedDoc[] = gaps.map((type) => ({
    type,
    slug: `${type}-${productKey(product)}`,
    title: `${product?.name ?? ''}${product ? ' · ' : ''}${DOC_TYPE[type].label}`,
  }))

  const docTasks: PlannedTask[] = gapDocs.map((d) => {
    const label = DOC_TYPE[d.type].label
    const role = ROLE_FOR[d.type] ?? '文档'
    return {
      kind: 'doc' as TaskKind,
      title: `起草《${label}》`,
      description: `补齐蓝图缺口：${label}`,
      brief: docBrief(req, product, label, role),
      targetDocSlug: d.slug,
    }
  })

  const workTask: PlannedTask = {
    kind: 'work',
    title: `落地实现 · ${req.title}`,
    description: '按定稿文档落地实现该需求',
    brief: workBrief(req, product),
    targetDocSlug: null,
  }

  return { gapDocs, tasks: [...docTasks, workTask] }
}
