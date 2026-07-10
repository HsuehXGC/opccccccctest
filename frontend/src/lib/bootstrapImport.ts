import { useStore } from '../store/useStore'
import { toast } from './toast'

// ── 首次启动自动导入（开发期种子）────────────────────────
// PlotMax 2.0 演示数据不塞进代码 bundle，而是放在 public/plotmax-import.json，
// 由 app 首次启动时 fetch 并合并进 store（经 store setState → persist 持久化）。
// 幂等：若已存在该项目则跳过；任何浏览器打开即自动获得同一份数据。
// 不需要时删除本文件 + App 里的调用 + public/plotmax-import.json 即可。

interface ImportPkg {
  project: { id: string; [k: string]: unknown }
  products: unknown[]
  docs: unknown[]
  requirements: unknown[]
  tasks: unknown[]
  botAssignments?: { botId: string; taskId: string }[]
}

const IMPORT_URL = '/plotmax-import.json'

export async function bootstrapImport(): Promise<void> {
  const state = useStore.getState()
  // 已导入过则跳过（存在该项目即视为已导入）
  if (state.projects.some((p) => p.id === 'project-plotmax2')) return

  let pkg: ImportPkg
  try {
    const res = await fetch(IMPORT_URL)
    if (!res.ok) return
    pkg = (await res.json()) as ImportPkg
  } catch {
    return // 无导入文件则静默跳过
  }
  if (!pkg?.project?.id) return

  // 再查一次，避免并发/竞态重复导入
  if (useStore.getState().projects.some((p) => p.id === pkg.project.id)) return

  const assign = new Map((pkg.botAssignments ?? []).map((a) => [a.botId, a.taskId]))
  useStore.setState((s) => ({
    projects: [...s.projects, pkg.project as never],
    products: [...s.products, ...(pkg.products as never[])],
    docs: [...(pkg.docs as never[]), ...s.docs],
    requirements: [...(pkg.requirements as never[]), ...s.requirements],
    tasks: [...(pkg.tasks as never[]), ...s.tasks],
    // in_progress 任务对应的机器人显示为「工作中」
    bots: s.bots.map((b) => (assign.has(b.id) ? { ...b, status: 'working', currentTaskId: assign.get(b.id)! } : b)),
  }))
  toast(`已导入 PlotMax 2.0：${pkg.products.length} 产品 · ${pkg.docs.length} 文档 · ${pkg.tasks.length} 任务`, 'info')
}
