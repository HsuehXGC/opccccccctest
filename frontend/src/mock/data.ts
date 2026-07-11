import type { Bot, Requirement, Task } from '../types'

// 固定时间基准，避免 SSR/首屏抖动
const T0 = 1_752_000_000_000

export const seedBots: Bot[] = [
  {
    id: 'bot-vela',
    orgId: 'org-1',
    name: 'Vela',
    role: '产品经理',
    model: 'claude-opus-4-8',
    status: 'idle',
    currentTaskId: null,
    skills: ['需求分析', 'PRD', '路线图', '用户研究'],
    completed: 19,
    avatarSeed: 'vela',
  },
  {
    id: 'bot-polaris',
    orgId: 'org-1',
    name: 'Polaris',
    role: '项目经理',
    model: 'claude-opus-4-8',
    status: 'idle',
    currentTaskId: null,
    skills: ['排期', '风险管理', '跨团队协调', '交付跟踪'],
    completed: 23,
    avatarSeed: 'polaris',
  },
  {
    id: 'bot-atlas',
    orgId: 'org-1',
    name: 'Atlas',
    role: '全栈工程',
    model: 'claude-opus-4-8',
    status: 'working',
    currentTaskId: 'task-1',
    skills: ['TypeScript', 'React', 'Node', '系统设计'],
    completed: 42,
    avatarSeed: 'atlas',
  },
  {
    id: 'bot-nova',
    orgId: 'org-1',
    name: 'Nova',
    role: '前端',
    model: 'claude-sonnet-4-6',
    status: 'working',
    currentTaskId: 'task-3',
    skills: ['React', 'Tailwind', '动效', '可访问性'],
    completed: 28,
    avatarSeed: 'nova',
  },
  {
    id: 'bot-orion',
    orgId: 'org-1',
    name: 'Orion',
    role: '后端',
    model: 'claude-sonnet-4-6',
    status: 'idle',
    currentTaskId: null,
    skills: ['Go', 'PostgreSQL', 'API 设计', '性能'],
    completed: 35,
    avatarSeed: 'orion',
  },
  {
    id: 'bot-lyra',
    orgId: 'org-1',
    name: 'Lyra',
    role: '数据分析',
    model: 'claude-opus-4-8',
    status: 'idle',
    currentTaskId: null,
    skills: ['SQL', 'Python', '可视化', '指标建模'],
    completed: 19,
    avatarSeed: 'lyra',
  },
  {
    id: 'bot-vega',
    orgId: 'org-1',
    name: 'Vega',
    role: '文案运营',
    model: 'claude-haiku-4-5',
    status: 'paused',
    currentTaskId: null,
    skills: ['文案', 'SEO', '社媒', '本地化'],
    completed: 51,
    avatarSeed: 'vega',
  },
  {
    id: 'bot-rigel',
    orgId: 'org-1',
    name: 'Rigel',
    role: '测试',
    model: 'claude-haiku-4-5',
    status: 'offline',
    currentTaskId: null,
    skills: ['E2E', '单测', '回归', 'CI'],
    completed: 12,
    avatarSeed: 'rigel',
  },
]

export const seedRequirements: Requirement[] = [
  {
    id: 'req-1',
    title: '上线企业官网 v2',
    description: '重构落地页，接入 CMS，移动端优化，目标转化率 +20%。',
    content: `## 背景
现有官网转化率偏低、移动端体验差，且内容更新依赖开发。

## 目标
- 转化率相对基线 **+20%**
- 首屏 LCP < 2s，Lighthouse > 90
- 非技术同学可自助编辑内容

## 范围
首页、产品页、定价页、联系表单。不含博客系统。

详细产品需求见 [[prd-website-v2]]，技术方案见 [[arch-website]]。`,
    priority: 'high',
    status: 'active',
    createdAt: T0 - 86_400_000 * 3,
    productId: 'product-website',
    taskIds: ['task-1', 'task-2', 'task-3'],
  },
  {
    id: 'req-2',
    title: '季度经营数据看板',
    description: '汇总销售、库存、客服数据，产出可交互 BI 看板，每周自动刷新。',
    content: `## 目标
把销售、库存、客服三方数据汇总成一个可交互 BI 看板，每周自动刷新。

## 交付
- 统一数据口径并入仓
- 可交互看板（按渠道/时段下钻）
- 周度自动刷新任务

产品需求详情见 [[prd-bi-dashboard]]。`,
    priority: 'medium',
    status: 'planning',
    createdAt: T0 - 86_400_000 * 1,
    productId: 'product-bi',
    taskIds: ['task-4', 'task-5'],
  },
  {
    id: 'req-3',
    title: '双十一大促文案包',
    description: '一套主视觉文案 + 20 条社媒短文案 + 邮件营销序列。',
    content: `## 目标
产出一整套大促营销物料，覆盖主视觉、社媒与邮件。

## 交付清单
- 主视觉文案 1 套
- 社媒短文案 20 条（含 A/B 版本）
- 邮件营销序列 1 套

> 合规检查通过后方可投放。`,
    priority: 'urgent',
    status: 'active',
    createdAt: T0 - 3_600_000 * 6,
    productId: 'product-promo',
    taskIds: ['task-6'],
  },
]

export const seedTasks: Task[] = [
  {
    id: 'task-1',
    title: '搭建落地页组件库',
    description: '基于设计稿实现响应式组件库，覆盖首页全部模块。',
    kind: 'work',
    status: 'in_progress',
    priority: 'high',
    productId: 'product-website',
    requirementId: 'req-1',
    botId: 'bot-atlas',
    brief: `实现企业官网 v2 的落地页组件库。\n\n**要求**\n- 覆盖 Hero / 特性 / 价格 / 联系表单模块\n- 响应式，移动端优先\n- 组件从 CMS 取数（见 [[api-cms]]）\n\n**验收**\n- 首页全部模块可用，通过设计走查`,
    targetDocSlug: null,
    output: null,
    dependsOn: [],
    progress: 64,
    createdAt: T0 - 86_400_000 * 2,
    log: ['拉取设计稿与设计 token', '生成 Hero / 特性 / 价格 组件', '正在接入 CMS 数据源…'],
  },
  {
    id: 'task-2',
    title: '接入 Headless CMS',
    description: '打通内容模型与前端渲染，支持非技术同学编辑。',
    kind: 'work',
    status: 'backlog',
    priority: 'medium',
    productId: 'product-website',
    requirementId: 'req-1',
    botId: null,
    brief: `按 [[api-cms]] 契约打通 CMS 内容层。\n\n**验收**\n- 编辑端改内容，前端 60s 内可见（ISR）`,
    targetDocSlug: null,
    output: null,
    dependsOn: ['task-1'],
    progress: 0,
    createdAt: T0 - 86_400_000 * 2,
    log: [],
  },
  {
    id: 'task-3',
    title: '移动端适配与性能优化',
    description: '首屏 LCP < 2s，图片懒加载，Lighthouse > 90。',
    kind: 'work',
    status: 'in_progress',
    priority: 'high',
    productId: 'product-website',
    requirementId: 'req-1',
    botId: 'bot-nova',
    brief: `优化企业官网 v2 首屏性能。\n\n**验收**\n- LCP < 2s，Lighthouse > 90\n- 图片全量懒加载 + AVIF`,
    targetDocSlug: null,
    output: null,
    dependsOn: [],
    progress: 38,
    createdAt: T0 - 86_400_000 * 1,
    log: ['审计现有首屏资源', '拆分关键 CSS，正在处理图片懒加载…'],
  },
  {
    id: 'task-4',
    title: '起草数据看板产品需求',
    description: '完善 BI 看板的 PRD，明确指标口径与刷新策略。',
    kind: 'doc',
    status: 'review',
    priority: 'medium',
    productId: 'product-bi',
    requirementId: 'req-2',
    botId: 'bot-lyra',
    brief: `完善 [[prd-bi-dashboard]]：补充指标口径、下钻维度、周度刷新策略与验收标准。\n\n**验收**\n- 三方数据口径统一表\n- 看板交互与刷新方案明确`,
    targetDocSlug: 'prd-bi-dashboard',
    output: null,
    dependsOn: [],
    progress: 100,
    createdAt: T0 - 86_400_000 * 1,
    log: ['梳理三方数据口径', '补充下钻维度与刷新策略', '等待人工复核 PRD'],
  },
  {
    id: 'task-5',
    title: 'BI 看板搭建',
    description: '产出可交互看板，支持周度自动刷新。',
    kind: 'work',
    status: 'backlog',
    priority: 'medium',
    productId: 'product-bi',
    requirementId: 'req-2',
    botId: null,
    brief: `按已定稿 PRD 搭建可交互 BI 看板。\n\n**验收**\n- 按渠道/时段下钻\n- 周度自动刷新`,
    targetDocSlug: null,
    output: null,
    dependsOn: ['task-4'],
    progress: 0,
    createdAt: T0 - 3_600_000 * 20,
    log: [],
  },
  {
    id: 'task-6',
    title: '社媒短文案 x20',
    description: '围绕大促主题产出 20 条差异化短文案，含 A/B 版本。',
    kind: 'work',
    status: 'done',
    priority: 'urgent',
    productId: 'product-promo',
    requirementId: 'req-3',
    botId: 'bot-vega',
    brief: `围绕双十一大促产出 20 条社媒短文案，每条含 A/B 版本。\n\n**验收**\n- 20 条差异化文案 + A/B\n- 通过合规检查`,
    targetDocSlug: null,
    output: '已交付 20 条短文案（含 A/B 版本），全部通过合规检查。示例：「爆款直降，手慢无——双十一，只等你。」',
    dependsOn: [],
    progress: 100,
    createdAt: T0 - 3_600_000 * 5,
    log: ['提炼卖点与调性', '产出 20 条文案', '完成 A/B 版本与合规检查'],
  },
]
