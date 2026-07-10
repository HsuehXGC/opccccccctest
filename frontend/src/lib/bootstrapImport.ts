import { useStore } from '../store/useStore'
import { toast } from './toast'

// ── 首次启动自动导入（开发期种子）────────────────────────
// 演示数据不塞进代码 bundle，放在 public/*.json，由 app 首次启动 fetch 合并进 store。
// 每个包的数据自带 orgId（PlotMax→org-1，Newton→hsueh218 的 org），登录后按 org 过滤显示。
// 幂等：若对应项目已存在则跳过。不需要时删除本文件 + App 调用 + public/*.json 即可。

interface ImportPkg {
  project: { id: string; name: string; [k: string]: unknown }
  products: unknown[]
  docs: unknown[]
  requirements: unknown[]
  tasks: unknown[]
  bots?: unknown[]
  botAssignments?: { botId: string; taskId: string }[]
}

async function importPackage(url: string, projectId: string): Promise<void> {
  if (useStore.getState().projects.some((p) => p.id === projectId)) return

  let pkg: ImportPkg
  try {
    const res = await fetch(url)
    if (!res.ok) return
    pkg = (await res.json()) as ImportPkg
  } catch {
    return // 无导入文件则静默跳过
  }
  if (!pkg?.project?.id || pkg.project.id !== projectId) return
  // 再查一次，避免并发/竞态重复导入
  if (useStore.getState().projects.some((p) => p.id === pkg.project.id)) return

  const assign = new Map((pkg.botAssignments ?? []).map((a) => [a.botId, a.taskId]))
  useStore.setState((s) => ({
    projects: [...s.projects, pkg.project as never],
    products: [...s.products, ...(pkg.products as never[])],
    docs: [...(pkg.docs as never[]), ...s.docs],
    requirements: [...(pkg.requirements as never[]), ...s.requirements],
    tasks: [...(pkg.tasks as never[]), ...s.tasks],
    // 包内自带的机器人（新 org）+ 既有机器人（按 botAssignments 标记为「工作中」）
    bots: [
      ...((pkg.bots as never[]) ?? []),
      ...s.bots.map((b) => (assign.has(b.id) ? { ...b, status: 'working' as const, currentTaskId: assign.get(b.id)! } : b)),
    ],
  }))
  // 兜底竞态：若当前登录用户正属于该包的 org 且无有效当前项目（新 org 唯一项目刚导入），落到该项目
  const st = useStore.getState()
  const projOrgId = (pkg.project as { orgId?: string }).orgId
  const validCurrent = st.projects.some((p) => p.id === st.currentProjectId && p.orgId === st.currentOrgId)
  if (st.currentOrgId && st.currentOrgId === projOrgId && !validCurrent) {
    useStore.setState({ currentProjectId: pkg.project.id })
  }
  toast(`已导入 ${pkg.project.name}：${pkg.products.length} 产品 · ${pkg.docs.length} 文档 · ${pkg.tasks.length} 任务`, 'info')
}

export async function bootstrapImport(): Promise<void> {
  await importPackage('/plotmax-import.json', 'project-plotmax2')
  await importPackage('/newton-import.json', 'newton')
}
