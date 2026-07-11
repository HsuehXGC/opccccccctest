// ── 领域模型 ──────────────────────────────────────────────
// 一个人管理多个 Claude CLI 机器人完成企业任务。核心链路：
//   企业需求(Requirement) → 拆解为任务(Task) → 部署机器人(Bot) 执行 → 看板追踪

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type RequirementStatus = 'draft' | 'planning' | 'active' | 'done'

// ── 账户体系 ──────────────────────────────────────────────
// 每个用户一个 Root 账户，可绑定多个成员账户，构成一个账户组（组织 org）。
// 账户组共享多个项目；虚拟人力（bots）属于账户组、跨项目共享。
export interface Account {
  id: string
  name: string
  email: string
  kind: 'root' | 'member'
  /** 所属账户组（组织） */
  orgId: string
  avatarSeed: string
  /** 成员账户的角色（展示用） */
  memberRole?: string
}

// ── 项目 ──────────────────────────────────────────────────
// 账户组共享的顶层工作区。一个项目含多个产品及其全套内容。
export interface Project {
  id: string
  orgId: string
  name: string
  description: string
  createdAt: number
}

// ── 本地算力（后期）──────────────────────────────────────
// 账户绑定的本地电脑，每台电脑跑一个个 claude/codex 执行器 = 虚拟人力背后的真实算力。
export interface Machine {
  id: string
  accountId: string
  /** 所属账户组（隔离作用域） */
  orgId: string
  name: string
  os: string
  status: 'online' | 'offline'
}
export interface Executor {
  id: string
  machineId: string
  kind: 'claude' | 'codex'
  label: string
  status: 'idle' | 'busy' | 'offline'
}

// ── 产品 ──────────────────────────────────────────────────
// 项目之下的一级内容实体、文档树的根命名空间。
// 需求、文档、任务都挂在产品之下。
export interface Product {
  id: string
  /** 所属项目 */
  projectId: string
  name: string
  description: string
  /** 当前主推的产品版本，如 v2.0.0 */
  currentVersion: string
}

export interface Requirement {
  id: string
  title: string
  /** 一句话摘要（列表/卡片展示用） */
  description: string
  /** 文档形式的正文（Markdown，可用 [[slug]] 关联产品文档） */
  content: string
  priority: Priority
  status: RequirementStatus
  createdAt: number
  /** 所属产品 */
  productId: string | null
  /** 由该需求拆解出的任务 id */
  taskIds: string[]
}

export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done'

/** 任务类型：文档任务产出/修订产品文档；执行任务产出工作成果 */
export type TaskKind = 'doc' | 'work'

export interface Task {
  id: string
  title: string
  description: string
  kind: TaskKind
  status: TaskStatus
  priority: Priority
  /** 所属产品（看板作用域） */
  productId: string | null
  /** 来源需求 */
  requirementId: string | null
  /** 承接该任务的机器人 id */
  botId: string | null
  /** 执行简报：给虚拟员工的指令 + 验收标准（= 将来 claude -p 的输入） */
  brief: string
  /** 文档任务：产出/修订的目标文档 slug */
  targetDocSlug: string | null
  /** 执行任务：完成后的成果（文档任务此处存起草的正文） */
  output: string | null
  /** 依赖：被这些任务阻塞（需先完成） */
  dependsOn: string[]
  /** 0-100，执行进度 */
  progress: number
  createdAt: number
  /** 机器人执行时的滚动日志 */
  log: string[]
}

// ── 产品文档 Wiki ─────────────────────────────────────────
// 虚拟员工产出的、覆盖产品全生命周期的文档。文档间用【类型化关系】互链，
// 混合版本模型：每篇文档独立迭代（v1/v2/v3 版本快照），并标注它所服务的产品版本。

// 覆盖产品生命周期五阶段的文档类型。核心类型每个产品默认应有，可选类型按需启用。
export type DocType =
  | 'vision' // ① 定义 · 愿景/业务目标(BRD)
  | 'prd' // ② 规划 · 产品需求
  | 'story' // ② 规划 · 用户故事
  | 'arch' // ③ 设计 · 技术架构
  | 'api' // ③ 设计 · 接口契约
  | 'data' // ③ 设计 · 数据模型
  | 'design' // ③ 设计 · 视觉设计
  | 'adr' // ③ 设计 · 决策记录
  | 'test' // ④ 验证 · 测试计划
  | 'release' // ⑤ 发布 · 发布说明

/** 生命周期阶段 */
export type DocPhase = 'define' | 'plan' | 'design' | 'verify' | 'release'

export type DocStatus = 'draft' | 'review' | 'approved' | 'archived'

// 文档间的类型化关系（有向）。工作流靠它判断上下游、自动建链。
export type RelType =
  | 'derives' // 派生自（下游 → 上游）
  | 'implements' // 实现
  | 'verifies' // 验证
  | 'decides' // 决策支撑
  | 'references' // 通用引用

export interface DocRelation {
  rel: RelType
  /** 关系指向的文档 slug */
  target: string
}

/** 一次修改的落地快照 */
export interface DocVersion {
  /** 文档自身版本号，如 v3 */
  version: string
  /** 该版本服务的产品版本，如 v1.2.0 */
  productVersion: string
  /** 该版本的 Markdown 全文 */
  content: string
  /** 起草/修订该版本的虚拟员工 */
  authorBotId: string | null
  status: DocStatus
  /** 修改说明 */
  note: string
  createdAt: number
}

export interface WikiDoc {
  slug: string
  title: string
  type: DocType
  /** 所属产品（文档树的根） */
  productId: string
  /** 当前负责的虚拟员工 */
  ownerBotId: string | null
  /** 可选：关联的企业需求 */
  requirementId: string | null
  /** 类型化关系（结构化上下游，蓝图/工作流用）。正文内的 [[slug]] 仍作为阅读用的通用引用。 */
  relations: DocRelation[]
  /** 版本快照，index 0 为当前版本（newest first） */
  versions: DocVersion[]
}

// ── 会议 ───────────────────────────────────────────────
// 虚拟人力(claude plan 模式) + 真人群聊，对项目立项/变更做 PM 讨论，
// 产品经理会后整理出执行计划 + 会议纪要，指导后续工作。
export type MeetingKind = 'kickoff' | 'change' | 'standup'
export type MeetingStatus = 'draft' | 'running' | 'done'

export interface MeetingMessage {
  id: string
  /** bot=虚拟人力 · user=真人 · system=系统 */
  speakerType: 'bot' | 'user' | 'system'
  speakerId: string
  speakerName: string
  speakerRole?: string
  avatarSeed?: string
  content: string
  /** 该发言所属讨论轮次（1 起）；多轮会议用于分组显示与「已有发言」筛选 */
  round?: number
  createdAt: number
}

export interface Meeting {
  id: string
  orgId: string
  projectId: string | null
  productId: string | null
  title: string
  /** 议题 / 背景 */
  agenda: string
  kind: MeetingKind
  status: MeetingStatus
  /** 参会虚拟人力 */
  participantBotIds: string[]
  /** 主持人补充的背景资料（自由文本，作为会议背景注入） */
  references: string
  /** 全文纳入知识库的文档 slug（其余文档只给摘要/标题） */
  fullDocSlugs: string[]
  /** 并行发言：所有虚拟人力同时发言（快，但发言互不可见）；否则顺序讨论 */
  parallel: boolean
  /** 讨论轮数：1=各自表态；≥2 时后续轮次能看到他人发言、相互反应/收敛/抛分歧 */
  rounds: number
  messages: MeetingMessage[]
  /** 产品经理会后整理的输出（执行计划 + 会议纪要，Markdown） */
  output: string
  createdAt: number
}

export type BotStatus = 'idle' | 'working' | 'paused' | 'offline'

/** 机器人角色 / 技能画像 —— 决定它擅长哪类任务 */
export type BotRole =
  | '产品经理'
  | '项目经理'
  | '全栈工程'
  | '前端'
  | '后端'
  | '数据分析'
  | '文案运营'
  | '测试'
  | '调研'

/** 岗位说明书 / 提示词配置 —— 组装成执行时 prepend 到任务 brief 前的 system prompt */
export interface BotCharter {
  /** 定位与使命（一段话） */
  mission: string
  /** 工作范围职责：能做什么 */
  canDo: string[]
  /** 边界：不能做什么 */
  cannotDo: string[]
  /** 核心技能 */
  coreSkills: string[]
}

export interface Bot {
  id: string
  /** 所属账户组（虚拟人力账户组内共享、跨项目共用、按 org 隔离） */
  orgId: string
  name: string
  role: BotRole
  /** 底层 Claude 模型 */
  model: string
  status: BotStatus
  /** 当前承接的任务 id */
  currentTaskId: string | null
  skills: string[]
  /** 累计完成任务数 */
  completed: number
  avatarSeed: string
  /** 岗位说明书 / 提示词配置；未设置时用角色默认模板 */
  charter?: BotCharter
}
