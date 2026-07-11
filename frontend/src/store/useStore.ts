import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Account,
  Bot,
  BotCharter,
  BotRole,
  Meeting,
  MeetingKind,
  MeetingMessage,
  MeetingStatus,
  DocRelation,
  DocStatus,
  DocType,
  Executor,
  Machine,
  Priority,
  Product,
  Project,
  RelType,
  Requirement,
  Task,
  TaskKind,
  TaskStatus,
  WikiDoc,
} from '../types'
import { seedBots, seedRequirements, seedTasks } from '../mock/data'
import { seedDocs } from '../mock/docs'
import { seedProducts } from '../mock/products'
import { seedAccounts, seedExecutors, seedMachines, seedProjects } from '../mock/accounts'
import { toast } from '../lib/toast'
import { planDecomposition } from '../lib/decompose'

/** 顶层导航视图 */
export type View = 'dashboard' | 'requirements' | 'wiki' | 'kanban' | 'workforce' | 'meetings' | 'account'

const nextVersion = (v: string) => `v${parseInt(v.replace(/^v/, ''), 10) + 1}`

// 机器人执行任务时会滚动输出的模拟日志片段
const WORK_LOG_SNIPPETS = [
  '分析任务上下文与约束…',
  '拆解为可执行子步骤',
  '调用工具读取相关文件',
  '生成初版实现',
  '自检并修正边界情况',
  '运行验证，观察输出',
  '整理交付物与说明',
]

let uid = 1000
const nextId = (p: string) => `${p}-${uid++}`

interface State {
  // 账户与项目
  accounts: Account[]
  currentAccountId: string
  /** 当前登录用户的账户组（由鉴权驱动）；全站按它隔离项目/机器人/机器 */
  currentOrgId: string | null
  projects: Project[]
  currentProjectId: string
  machines: Machine[]
  executors: Executor[]

  products: Product[]
  requirements: Requirement[]
  tasks: Task[]
  bots: Bot[]
  docs: WikiDoc[]
  meetings: Meeting[]
  simRunning: boolean

  // 账户与项目
  switchAccount: (accountId: string) => void
  addMemberAccount: (input: { name: string; email: string; memberRole: string }) => void
  /** 登录/切换账户组：设定当前 org 并把 currentProjectId 落到该 org 的首个项目 */
  enterOrg: (orgId: string | null) => void
  switchProject: (projectId: string) => void
  addProject: (input: { name: string; description: string }) => void
  addProduct: (input: { name: string; description: string; currentVersion: string }) => string
  /** 「绑定电脑」：一台 agent 接入，登记机器并探测出默认执行器 */
  enrollMachine: (input: { name: string; os: string }) => void

  // 导航（提到 store 以支持跨模块跳转，如从需求跳到 Wiki 对应文档）
  view: View
  setView: (v: View) => void
  /** 请求 Wiki 定位到某产品的某文档 */
  focusDoc: { productId: string; slug: string } | null
  openDoc: (productId: string, slug: string) => void
  clearFocusDoc: () => void
  /** 请求看板打开某任务抽屉（命令面板等跨模块跳转用） */
  focusTaskId: string | null
  openTask: (taskId: string) => void
  clearFocusTask: () => void
  /** 请求需求工作台定位到某产品 */
  focusProductId: string | null
  openProduct: (productId: string) => void
  clearFocusProduct: () => void

  // 需求
  addRequirement: (input: {
    title: string
    description: string
    priority: Priority
    content?: string
    productId?: string | null
  }) => void
  updateRequirement: (
    id: string,
    patch: Partial<Pick<Requirement, 'title' | 'description' | 'content' | 'priority' | 'status'>>,
  ) => void

  // 任务
  moveTask: (taskId: string, status: TaskStatus) => void
  assignTask: (taskId: string, botId: string) => void
  unassignTask: (taskId: string) => void
  addTask: (input: {
    title: string
    description: string
    priority: Priority
    requirementId: string | null
    kind?: TaskKind
    productId?: string | null
    brief?: string
    targetDocSlug?: string | null
    dependsOn?: string[]
  }) => void
  updateTask: (
    id: string,
    patch: Partial<Pick<Task, 'title' | 'description' | 'brief' | 'output' | 'priority' | 'kind' | 'targetDocSlug'>>,
  ) => void
  addDependency: (taskId: string, dependsOnId: string) => void
  removeDependency: (taskId: string, dependsOnId: string) => void
  /** 记录一次真实派单执行的结果：成功则回填交付物，并追加执行日志 */
  recordTaskRun: (taskId: string, input: { output: string; ok: boolean }) => void
  /** 智能拆解：按需求正文 + 蓝图缺口，一键生成一组带 brief 的文档/执行任务（含缺口文档草稿）。返回生成的任务数 */
  decomposeRequirement: (requirementId: string) => number

  // 机器人
  deployBot: (input: { name: string; role: BotRole; model: string; skills: string[] }) => void
  setBotStatus: (botId: string, status: Bot['status']) => void
  /** 配置岗位说明书 / 提示词 */
  updateBotCharter: (botId: string, charter: BotCharter) => void

  // 会议
  createMeeting: (input: {
    title: string
    agenda: string
    kind: MeetingKind
    productId: string | null
    participantBotIds: string[]
    references?: string
    fullDocSlugs?: string[]
    parallel?: boolean
  }) => string
  setMeetingReferences: (meetingId: string, references: string) => void
  addMeetingMessage: (meetingId: string, msg: Omit<MeetingMessage, 'id' | 'createdAt'>) => string
  appendMeetingMessage: (meetingId: string, msgId: string, chunk: string) => void
  setMeetingMessage: (meetingId: string, msgId: string, content: string) => void
  setMeetingStatus: (meetingId: string, status: MeetingStatus) => void
  setMeetingOutput: (meetingId: string, output: string) => void
  removeMeeting: (meetingId: string) => void

  // 产品文档 Wiki
  addDoc: (input: {
    slug: string
    title: string
    type: DocType
    productId: string
    productVersion: string
    requirementId: string | null
    ownerBotId: string | null
    relations?: DocRelation[]
    content?: string
  }) => void
  /** 增删文档间的类型化关系 */
  addRelation: (slug: string, relation: DocRelation) => void
  removeRelation: (slug: string, rel: RelType, target: string) => void
  /** 保存一次修改 = 生成新版本快照（文档版本号 +1） */
  saveDocVersion: (
    slug: string,
    input: { content: string; note: string; authorBotId: string | null; productVersion: string; status: DocStatus },
  ) => void
  setDocStatus: (slug: string, status: DocStatus) => void
  /** 回滚到历史版本：以旧内容生成一个新版本 */
  rollbackDoc: (slug: string, version: string) => void

  // 模拟
  toggleSim: (on: boolean) => void
  tick: () => void
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
  accounts: seedAccounts,
  currentAccountId: 'acc-root',
  currentOrgId: null,
  projects: seedProjects,
  currentProjectId: seedProjects[0]?.id ?? '',
  machines: seedMachines,
  executors: seedExecutors,

  products: seedProducts,
  requirements: seedRequirements,
  tasks: seedTasks,
  bots: seedBots,
  docs: seedDocs,
  meetings: [],
  simRunning: true,

  switchAccount: (currentAccountId) => set({ currentAccountId }),
  addMemberAccount: ({ name, email, memberRole }) =>
    set((s) => {
      const root = s.accounts.find((a) => a.id === s.currentAccountId) ?? s.accounts[0]
      return {
        accounts: [
          ...s.accounts,
          {
            id: nextId('acc'),
            name,
            email,
            kind: 'member',
            orgId: root.orgId,
            avatarSeed: name.toLowerCase(),
            memberRole,
          },
        ],
      }
    }),
  enterOrg: (orgId) =>
    set((s) => {
      // 落到该账户组的首个项目（新 org 无项目则置空）
      const first = orgId ? s.projects.find((p) => p.orgId === orgId) : undefined
      return { currentOrgId: orgId, currentProjectId: first?.id ?? '' }
    }),
  switchProject: (currentProjectId) => set({ currentProjectId }),
  addProduct: ({ name, description, currentVersion }) => {
    const id = nextId('product')
    set((s) => ({
      products: [...s.products, { id, projectId: s.currentProjectId, name, description, currentVersion }],
    }))
    return id
  },
  enrollMachine: ({ name, os }) =>
    set((s) => {
      const mid = nextId('m')
      return {
        machines: [...s.machines, { id: mid, accountId: s.currentAccountId, orgId: s.currentOrgId ?? 'org-1', name, os, status: 'online' }],
        executors: [
          ...s.executors,
          { id: nextId('e'), machineId: mid, kind: 'claude', label: 'claude · 主号', status: 'idle' },
          { id: nextId('e'), machineId: mid, kind: 'codex', label: 'codex · 工程', status: 'idle' },
        ],
      }
    }),
  addProject: ({ name, description }) =>
    set((s) => {
      const root = s.accounts.find((a) => a.id === s.currentAccountId) ?? s.accounts[0]
      const orgId = s.currentOrgId ?? root?.orgId ?? 'org-1'
      const id = nextId('project')
      return {
        projects: [...s.projects, { id, orgId, name, description, createdAt: Date.now() }],
        currentProjectId: id,
      }
    }),

  view: 'dashboard',
  setView: (view) => set({ view }),
  focusDoc: null,
  openDoc: (productId, slug) =>
    set((s) => {
      const prod = s.products.find((p) => p.id === productId)
      return {
        view: 'wiki',
        focusDoc: { productId, slug },
        currentProjectId: prod?.projectId ?? s.currentProjectId,
      }
    }),
  clearFocusDoc: () => set({ focusDoc: null }),
  focusTaskId: null,
  openTask: (taskId) =>
    set((s) => {
      const task = s.tasks.find((t) => t.id === taskId)
      const prod = task?.productId ? s.products.find((p) => p.id === task.productId) : null
      return { view: 'kanban', focusTaskId: taskId, currentProjectId: prod?.projectId ?? s.currentProjectId }
    }),
  clearFocusTask: () => set({ focusTaskId: null }),
  focusProductId: null,
  openProduct: (productId) =>
    set((s) => {
      const prod = s.products.find((p) => p.id === productId)
      return {
        view: 'requirements',
        focusProductId: productId,
        currentProjectId: prod?.projectId ?? s.currentProjectId,
      }
    }),
  clearFocusProduct: () => set({ focusProductId: null }),

  addRequirement: ({ title, description, priority, content, productId }) =>
    set((s) => ({
      requirements: [
        {
          id: nextId('req'),
          title,
          description,
          content: content ?? `## 目标\n\n> 待补充需求正文，可用 [[slug]] 关联产品文档。`,
          priority,
          status: 'planning',
          createdAt: Date.now(),
          productId: productId ?? null,
          taskIds: [],
        },
        ...s.requirements,
      ],
    })),

  updateRequirement: (id, patch) =>
    set((s) => ({
      requirements: s.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  addTask: ({ title, description, priority, requirementId, kind, productId, brief, targetDocSlug, dependsOn }) =>
    set((s) => {
      const id = nextId('task')
      const req = requirementId ? s.requirements.find((r) => r.id === requirementId) : null
      const task: Task = {
        id,
        title,
        description,
        kind: kind ?? 'work',
        status: 'backlog',
        priority,
        productId: productId ?? req?.productId ?? null,
        requirementId,
        botId: null,
        brief: brief ?? '',
        targetDocSlug: targetDocSlug ?? null,
        output: null,
        dependsOn: dependsOn ?? [],
        progress: 0,
        createdAt: Date.now(),
        log: [],
      }
      return {
        tasks: [task, ...s.tasks],
        requirements: requirementId
          ? s.requirements.map((r) =>
              r.id === requirementId ? { ...r, taskIds: [...r.taskIds, id] } : r,
            )
          : s.requirements,
      }
    }),

  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  addDependency: (taskId, dependsOnId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId && taskId !== dependsOnId && !t.dependsOn.includes(dependsOnId)
          ? { ...t, dependsOn: [...t.dependsOn, dependsOnId] }
          : t,
      ),
    })),

  removeDependency: (taskId, dependsOnId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== dependsOnId) } : t,
      ),
    })),

  recordTaskRun: (taskId, { output, ok }) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              output: ok ? output : t.output,
              log: [...t.log, ok ? '✓ 真实派单执行完成，产出已回填交付物' : '✗ 派单执行失败'].slice(-12),
            }
          : t,
      ),
    })),

  decomposeRequirement: (requirementId) => {
    const s = get()
    const req = s.requirements.find((r) => r.id === requirementId)
    if (!req) return 0
    const product = req.productId ? s.products.find((p) => p.id === req.productId) ?? null : null
    const plan = planDecomposition(req, product, s.docs)
    // 先补齐蓝图缺口文档草稿（作为文档任务的交付目标，完成后闭环生成新版本）
    for (const d of plan.gapDocs) {
      get().addDoc({
        slug: d.slug,
        title: d.title,
        type: d.type,
        productId: product?.id ?? '',
        productVersion: product?.currentVersion ?? 'v1.0.0',
        requirementId: req.id,
        ownerBotId: null,
        content: `# ${d.title}\n\n> 由需求「${req.title}」智能拆解生成的占位草稿，待虚拟员工按简报补全。`,
      })
    }
    // 再生成带 brief 的文档/执行任务
    for (const t of plan.tasks) {
      get().addTask({
        title: t.title,
        description: t.description,
        priority: req.priority,
        requirementId: req.id,
        kind: t.kind,
        productId: product?.id ?? null,
        brief: t.brief,
        targetDocSlug: t.targetDocSlug,
      })
    }
    return plan.tasks.length
  },

  moveTask: (taskId, status) =>
    set((s) => {
      const task = s.tasks.find((t) => t.id === taskId)
      const tasks = s.tasks.map((t) => {
        if (t.id !== taskId) return t
        const progress = status === 'done' ? 100 : status === 'backlog' ? 0 : t.progress
        return { ...t, status, progress }
      })
      // 文档任务完成 → 目标文档落地一个新版本（交付物闭环）
      let docs = s.docs
      if (status === 'done' && task?.kind === 'doc' && task.targetDocSlug) {
        docs = s.docs.map((d) => {
          if (d.slug !== task.targetDocSlug) return d
          const version = nextVersion(d.versions[0]?.version ?? 'v0')
          return {
            ...d,
            versions: [
              {
                version,
                productVersion: d.versions[0]?.productVersion ?? 'v1.0.0',
                content: task.output || d.versions[0]?.content || `# ${d.title}`,
                note: `由任务「${task.title}」交付`,
                authorBotId: task.botId,
                status: 'review',
                createdAt: Date.now(),
              },
              ...d.versions,
            ],
          }
        })
      }
      return {
        tasks,
        docs,
        // 拖回 backlog 时释放机器人
        bots:
          status === 'backlog'
            ? s.bots.map((b) =>
                b.currentTaskId === taskId ? { ...b, status: 'idle', currentTaskId: null } : b,
              )
            : s.bots,
      }
    }),

  assignTask: (taskId, botId) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? { ...t, botId, status: t.status === 'backlog' ? 'in_progress' : t.status }
          : t,
      ),
      bots: s.bots.map((b) => {
        if (b.id === botId) return { ...b, status: 'working', currentTaskId: taskId }
        // 一个机器人同一时刻只承接一个任务
        if (b.currentTaskId === taskId) return { ...b, currentTaskId: null, status: 'idle' }
        return b
      }),
    })),

  unassignTask: (taskId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, botId: null } : t)),
      bots: s.bots.map((b) =>
        b.currentTaskId === taskId ? { ...b, status: 'idle', currentTaskId: null } : b,
      ),
    })),

  deployBot: ({ name, role, model, skills }) =>
    set((s) => ({
      bots: [
        ...s.bots,
        {
          id: nextId('bot'),
          orgId: s.currentOrgId ?? 'org-1',
          name,
          role,
          model,
          status: 'idle',
          currentTaskId: null,
          skills,
          completed: 0,
          avatarSeed: name.toLowerCase(),
        },
      ],
    })),

  setBotStatus: (botId, status) =>
    set((s) => ({
      bots: s.bots.map((b) => (b.id === botId ? { ...b, status } : b)),
    })),

  updateBotCharter: (botId, charter) =>
    set((s) => ({
      bots: s.bots.map((b) => (b.id === botId ? { ...b, charter } : b)),
    })),

  // ── 会议 ──────────────────────────────────────────────
  createMeeting: ({ title, agenda, kind, productId, participantBotIds, references, fullDocSlugs, parallel }) => {
    const id = nextId('meeting')
    set((s) => {
      const prod = productId ? s.products.find((p) => p.id === productId) : null
      const meeting: Meeting = {
        id,
        orgId: s.currentOrgId ?? 'org-1',
        projectId: prod?.projectId ?? s.currentProjectId,
        productId: productId ?? null,
        title,
        agenda,
        kind,
        status: 'draft',
        participantBotIds,
        references: references ?? '',
        fullDocSlugs: fullDocSlugs ?? [],
        parallel: parallel ?? false,
        messages: [],
        output: '',
        createdAt: Date.now(),
      }
      return { meetings: [meeting, ...s.meetings] }
    })
    return id
  },
  setMeetingReferences: (meetingId, references) =>
    set((s) => ({ meetings: s.meetings.map((m) => (m.id === meetingId ? { ...m, references } : m)) })),
  addMeetingMessage: (meetingId, msg) => {
    const mid = nextId('msg')
    set((s) => ({
      meetings: s.meetings.map((m) =>
        m.id === meetingId ? { ...m, messages: [...m.messages, { ...msg, id: mid, createdAt: Date.now() }] } : m,
      ),
    }))
    return mid
  },
  appendMeetingMessage: (meetingId, msgId, chunk) =>
    set((s) => ({
      meetings: s.meetings.map((m) =>
        m.id === meetingId
          ? { ...m, messages: m.messages.map((x) => (x.id === msgId ? { ...x, content: x.content + chunk } : x)) }
          : m,
      ),
    })),
  setMeetingMessage: (meetingId, msgId, content) =>
    set((s) => ({
      meetings: s.meetings.map((m) =>
        m.id === meetingId ? { ...m, messages: m.messages.map((x) => (x.id === msgId ? { ...x, content } : x)) } : m,
      ),
    })),
  setMeetingStatus: (meetingId, status) =>
    set((s) => ({ meetings: s.meetings.map((m) => (m.id === meetingId ? { ...m, status } : m)) })),
  setMeetingOutput: (meetingId, output) =>
    set((s) => ({ meetings: s.meetings.map((m) => (m.id === meetingId ? { ...m, output } : m)) })),
  removeMeeting: (meetingId) => set((s) => ({ meetings: s.meetings.filter((m) => m.id !== meetingId) })),

  addDoc: ({ slug, title, type, productId, productVersion, requirementId, ownerBotId, relations, content }) =>
    set((s) => {
      if (s.docs.some((d) => d.slug === slug)) return s
      const doc: WikiDoc = {
        slug,
        title,
        type,
        productId,
        ownerBotId,
        requirementId,
        relations: relations ?? [],
        versions: [
          {
            version: 'v1',
            productVersion,
            status: 'draft',
            authorBotId: ownerBotId,
            note: '初稿',
            createdAt: Date.now(),
            content: content ?? `# ${title}\n\n> 由虚拟员工起草中…可在此补充内容，用 [[slug]] 关联其它文档。`,
          },
        ],
      }
      return { docs: [doc, ...s.docs] }
    }),

  addRelation: (slug, relation) =>
    set((s) => ({
      docs: s.docs.map((d) => {
        if (d.slug !== slug) return d
        if (d.relations.some((r) => r.rel === relation.rel && r.target === relation.target)) return d
        return { ...d, relations: [...d.relations, relation] }
      }),
    })),

  removeRelation: (slug, rel, target) =>
    set((s) => ({
      docs: s.docs.map((d) =>
        d.slug === slug
          ? { ...d, relations: d.relations.filter((r) => !(r.rel === rel && r.target === target)) }
          : d,
      ),
    })),

  saveDocVersion: (slug, { content, note, authorBotId, productVersion, status }) =>
    set((s) => ({
      docs: s.docs.map((d) => {
        if (d.slug !== slug) return d
        const version = nextVersion(d.versions[0]?.version ?? 'v0')
        return {
          ...d,
          ownerBotId: authorBotId ?? d.ownerBotId,
          versions: [
            { version, productVersion, content, note, authorBotId, status, createdAt: Date.now() },
            ...d.versions,
          ],
        }
      }),
    })),

  setDocStatus: (slug, status) =>
    set((s) => ({
      docs: s.docs.map((d) =>
        d.slug === slug
          ? { ...d, versions: d.versions.map((v, i) => (i === 0 ? { ...v, status } : v)) }
          : d,
      ),
    })),

  rollbackDoc: (slug, version) =>
    set((s) => ({
      docs: s.docs.map((d) => {
        if (d.slug !== slug) return d
        const target = d.versions.find((v) => v.version === version)
        if (!target) return d
        const nv = nextVersion(d.versions[0].version)
        return {
          ...d,
          versions: [
            {
              version: nv,
              productVersion: target.productVersion,
              content: target.content,
              note: `回滚到 ${version}`,
              authorBotId: d.ownerBotId,
              status: 'draft',
              createdAt: Date.now(),
            },
            ...d.versions,
          ],
        }
      }),
    })),

  toggleSim: (on) => set({ simRunning: on }),

  // 每个 tick 推进所有「工作中」机器人的任务进度，并滚动日志
  tick: () => {
    if (!get().simRunning) return
    const finishedTitles: string[] = []
    set((s) => {
      const finished: string[] = []
      const tasks = s.tasks.map((t) => {
        const bot = s.bots.find((b) => b.id === t.botId && b.status === 'working')
        if (!bot || t.status !== 'in_progress') return t
        const inc = 3 + Math.floor(Math.random() * 7)
        const progress = Math.min(100, t.progress + inc)
        const log =
          Math.random() > 0.55
            ? [...t.log, WORK_LOG_SNIPPETS[Math.floor(Math.random() * WORK_LOG_SNIPPETS.length)]].slice(-8)
            : t.log
        if (progress >= 100) {
          finished.push(t.id)
          finishedTitles.push(t.title)
          return { ...t, progress: 100, status: 'review' as TaskStatus, log: [...log, '✓ 执行完成，待复核'].slice(-8) }
        }
        return { ...t, progress, log }
      })
      const bots = s.bots.map((b) =>
        b.currentTaskId && finished.includes(b.currentTaskId)
          ? { ...b, status: 'idle' as const, currentTaskId: null, completed: b.completed + 1 }
          : b,
      )
      return { tasks, bots }
    })
    // set 之后再弹反馈，避免在更新期触发跨 store 副作用
    finishedTitles.forEach((title) => toast(`「${title}」执行完成，待复核`, 'info'))
  },
    }),
    {
      name: 'opc-store',
      version: 1,
      // 只持久化数据与当前作用域；瞬态跳转焦点（focusDoc/focusTaskId/focusProductId）不持久化
      partialize: (s) => ({
        accounts: s.accounts,
        currentAccountId: s.currentAccountId,
        currentOrgId: s.currentOrgId,
        projects: s.projects,
        currentProjectId: s.currentProjectId,
        machines: s.machines,
        executors: s.executors,
        products: s.products,
        requirements: s.requirements,
        tasks: s.tasks,
        bots: s.bots,
        docs: s.docs,
        meetings: s.meetings,
        simRunning: s.simRunning,
        view: s.view,
      }),
      // 刷新后修复自增 id 计数器：扫描既有 id 的数字后缀，避免新建项与旧 id 冲突
      onRehydrateStorage: () => (state) => {
        if (!state) return
        let max = uid
        const scan = (arr: { id: string }[] | undefined) =>
          arr?.forEach((x) => {
            const n = parseInt(x.id.slice(x.id.lastIndexOf('-') + 1), 10)
            if (Number.isFinite(n)) max = Math.max(max, n + 1)
          })
        scan(state.tasks)
        scan(state.requirements)
        scan(state.products)
        scan(state.projects)
        scan(state.accounts)
        scan(state.bots)
        scan(state.machines)
        scan(state.executors)
        uid = max
        // 迁移：老数据的 bots/machines 无 orgId，回填为 org-1（种子账户组）
        state.bots?.forEach((b) => {
          if (!b.orgId) b.orgId = 'org-1'
        })
        state.machines?.forEach((m) => {
          if (!m.orgId) m.orgId = 'org-1'
        })
      },
    },
  ),
)
