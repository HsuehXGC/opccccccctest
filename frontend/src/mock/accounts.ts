import type { Account, Executor, Machine, Project } from '../types'

const T0 = 1_752_000_000_000

// 一个账户组（组织）：Root 账户 + 绑定的成员账户
export const seedAccounts: Account[] = [
  {
    id: 'acc-root',
    name: '陈学官',
    email: 'xueguanchen@gmail.com',
    kind: 'root',
    orgId: 'org-1',
    avatarSeed: 'root',
  },
  {
    id: 'acc-m1',
    name: '林工',
    email: 'lin@team.opc',
    kind: 'member',
    orgId: 'org-1',
    avatarSeed: 'lingong',
    memberRole: '编辑',
  },
  {
    id: 'acc-m2',
    name: '周运营',
    email: 'zhou@team.opc',
    kind: 'member',
    orgId: 'org-1',
    avatarSeed: 'zhouyy',
    memberRole: '只读',
  },
]

// 账户组共享的项目（很适合代理/多客户场景）
export const seedProjects: Project[] = [
  {
    id: 'project-alpha',
    orgId: 'org-1',
    name: '云舟数字',
    description: '官网重构 + 大促营销的客户项目。',
    createdAt: T0 - 86_400_000 * 10,
  },
  {
    id: 'project-bravo',
    orgId: 'org-1',
    name: '数聚科技',
    description: '经营数据中台与 BI 看板。',
    createdAt: T0 - 86_400_000 * 4,
  },
]

// 本地算力（后期预览）：账户绑定的电脑 + 上面跑的 claude/codex 执行器
export const seedMachines: Machine[] = [
  { id: 'm-1', accountId: 'acc-root', name: '陈学官 · MacBook Pro', os: 'macOS 15', status: 'online' },
  { id: 'm-2', accountId: 'acc-m1', name: '林工 · 工作站', os: 'Ubuntu 24.04', status: 'online' },
  { id: 'm-3', accountId: 'acc-m2', name: '周运营 · 笔记本', os: 'Windows 11', status: 'offline' },
]

export const seedExecutors: Executor[] = [
  { id: 'e-1', machineId: 'm-1', kind: 'claude', label: 'claude · 主号', status: 'busy' },
  { id: 'e-2', machineId: 'm-1', kind: 'codex', label: 'codex · 工程', status: 'idle' },
  { id: 'e-3', machineId: 'm-2', kind: 'claude', label: 'claude · 后端', status: 'idle' },
  { id: 'e-4', machineId: 'm-2', kind: 'codex', label: 'codex · 测试', status: 'idle' },
  { id: 'e-5', machineId: 'm-3', kind: 'claude', label: 'claude · 文案', status: 'offline' },
]
