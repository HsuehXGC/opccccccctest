import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 内部/隐藏算力 ─────────────────────────────────────────────
// 被标为「系统集成 agent」的机器：不参与普通 org 任务调度，只跑 integration 类 job。
// 按 (orgId, machineName) 持久化到 .data/internal-machines.json。
const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', '.data', 'internal-machines.json')
const key = (org: string, name: string) => `${org}::${name}`

let set = new Set<string>()
try {
  if (existsSync(FILE)) set = new Set(JSON.parse(readFileSync(FILE, 'utf8')))
} catch {
  /* 损坏则从空开始 */
}
function persist() {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify([...set]))
  } catch {
    /* 落盘失败不致命，内存态仍生效 */
  }
}

export const isInternal = (orgId: string, name: string) => set.has(key(orgId, name))
export function setInternal(orgId: string, name: string, on: boolean): void {
  if (on) set.add(key(orgId, name))
  else set.delete(key(orgId, name))
  persist()
}
