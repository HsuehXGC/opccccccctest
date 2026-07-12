import { useEffect, useState } from 'react'
import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { authApi } from '../lib/authApi'
import { Modal, Field, inputCls } from './Modal'
import { toast } from '../lib/toast'

const STACKS: { key: string; label: string }[] = [
  { key: 'auto', label: '让 OPC 决定（按描述+机器工具链选）' },
  { key: '静态站（纯 HTML/CSS/JS）', label: '静态站（纯 HTML/CSS/JS，零依赖）' },
  { key: 'Vite + React + TypeScript', label: 'Vite + React + TS（现代前端站）' },
  { key: 'Next.js', label: 'Next.js（带路由的 React 站）' },
  { key: 'Node + Express', label: 'Node + Express（后端/API）' },
  { key: 'Spring Boot (Java 17 + Maven)', label: 'Spring Boot（Java 17 + Maven）' },
  { key: 'Python + FastAPI', label: 'Python + FastAPI' },
]

const sec = (out: string, name: string) => (out.match(new RegExp(`===${name}===\\s*\\n?([^\\n=]*)`))?.[1] ?? '').trim()

// 让 OPC 在执行器机器上「git init 新仓库 + 脚手架初始代码 + 自动填工作区」
export function ProvisionModal({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const setProjectWorkspace = useStore((s) => s.setProjectWorkspace)
  const token = useAuth((s) => s.token)
  const [machines, setMachines] = useState<string[]>([])
  const [machine, setMachine] = useState('')
  const [stack, setStack] = useState('auto')
  const [desc, setDesc] = useState('')
  const [phase, setPhase] = useState<'idle' | 'init' | 'scaffold' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!token) return
    authApi.machines(token).then((r) => {
      const on = r.machines.filter((m) => m.online).map((m) => m.machine.name)
      setMachines(on)
      setMachine((m) => m || on[0] || '')
    }).catch(() => {})
  }, [token])

  // 入队一个 job 并轮询到完成
  async function runWait(kind: string, prompt: string, cwd: string | undefined, refId: string): Promise<{ ok: boolean; output: string; error: string | null }> {
    await authApi.enqueueJobs(token!, [{ kind, refType: kind, refId, title: kind, prompt, cwd: cwd ?? null, targetMachine: machine || null }])
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      const { jobs } = await authApi.listJobs(token!, { refId })
      const j = jobs[0]
      if (!j) continue
      if (j.status === 'done') return { ok: true, output: j.output, error: null }
      if (j.status === 'error') return { ok: false, output: j.output, error: j.error }
    }
    return { ok: false, output: '', error: '超时' }
  }

  async function provision() {
    if (!token || !machine) { toast('请选择执行机器', 'warn'); return }
    const slug = (projectName || 'opc-project').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 40) || 'opc-project'
    const stamp = Math.random().toString(36).slice(2, 7)
    try {
      // 1. 建目录 + git init，取绝对路径
      setPhase('init'); setMsg('在执行器上新建仓库…')
      const init = await runWait(
        'provision',
        `set -e\nDIR="$HOME/opc-projects/${slug}-${stamp}"\nmkdir -p "$DIR"\ncd "$DIR"\ngit init -q\ngit symbolic-ref HEAD refs/heads/main 2>/dev/null || true\necho "===REPO===";\npwd`,
        undefined,
        `provision:${projectId}:${stamp}`,
      )
      const repoPath = sec(init.output, 'REPO')
      if (!init.ok || !repoPath) throw new Error('建仓库失败：' + (init.error || init.output).slice(-200))

      // 2. 脚手架（claude 在新仓库里生成初始代码并提交）
      setPhase('scaffold'); setMsg('OPC 正在脚手架初始代码（这一步可能 1–3 分钟）…')
      const stackReq = stack === 'auto'
        ? '选一个**适合上述描述、且这台机器已装好工具链（有 node/npm、java17+maven、python3）的简单栈**'
        : `使用 **${stack}**`
      const scaffoldPrompt = [
        '你在一个刚 `git init` 的空目录里工作，当前目录=项目根。',
        `为项目「${projectName}」创建一个**最小可运行**的代码骨架。`,
        `项目描述：${desc || projectName}`,
        `技术栈：${stackReq}。`,
        '',
        '要求：',
        '1. 建一个**能构建、能本地运行**的最小骨架（首页/入口 + 基本结构），别搞太大，够起步即可。',
        '2. 加合适的 `.gitignore`（排除 node_modules / target / dist / .venv 等）。',
        '3. 如需依赖，安装好（如 `npm install`），确保构建能过。',
        '4. **只 `git add` 你新建的源码与配置文件**（绝不 add node_modules/target 等），然后 `git commit -m "chore: scaffold ' + projectName + '"`。',
        '5. 最后**严格输出**以下五段（供系统解析，命令要能在本机直接跑）：',
        '===BUILD===',
        '<构建命令，如 npm run build 或 mvn -B -DskipTests package；纯静态站可写 true>',
        '===TEST===',
        '<测试命令，如 npm test 或 mvn -B test；没有就写 true>',
        '===RUN===',
        '<本地运行/预览命令，如 npm run dev 或 java -jar target/xxx.jar>',
        '===ENV===',
        '<执行命令前需要的 shell 前奏，如 export JAVA_HOME=...; export PATH=...；没有特殊需求就留空一行>',
      ].join('\n')
      const sc = await runWait('task', scaffoldPrompt, repoPath, `scaffold:${projectId}:${stamp}`)
      if (!sc.ok) throw new Error('脚手架失败：' + (sc.error || '').slice(-200))
      const buildCmd = sec(sc.output, 'BUILD') || 'true'
      const testCmd = sec(sc.output, 'TEST') || 'true'
      const runCmd = sec(sc.output, 'RUN')
      const env = sec(sc.output, 'ENV')

      // 3. 写入工作区（浏览器 store 为源，随后同步 PG）
      setProjectWorkspace(projectId, { repoPath, branch: 'main', buildCmd, testCmd, runCmd, env: env || undefined, machine })
      setPhase('done'); setMsg(`已在 ${machine} 上创建：${repoPath}`)
      toast('项目代码已新建并接好工作区，去「发布」页就能自驾了', 'success')
    } catch (err) {
      setPhase('error'); setMsg((err as Error).message)
    }
  }

  const busy = phase === 'init' || phase === 'scaffold'
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`AI 新建代码 · ${projectName}`}>
      <div className="mb-3 rounded-lg bg-brand-soft/50 px-3 py-2 text-[12px] text-slate-600">
        OPC 会在执行器机器上 <b>git init 一个全新仓库、脚手架出初始代码并提交</b>，再自动填好工作区——不碰 GitHub、不用你本地操作。之后即可自驾迭代。
      </div>
      {machines.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">没有在线执行器。先在一台装好 claude + 工具链的机器上启动 agent（团队与账户 → 本地算力 → 绑定电脑）。</p>
      ) : (
        <>
          <Field label="执行机器（在它本地新建仓库）">
            <select className={inputCls} value={machine} onChange={(e) => setMachine(e.target.value)} disabled={busy}>
              {machines.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="技术栈">
            <select className={inputCls} value={stack} onChange={(e) => setStack(e.target.value)} disabled={busy}>
              {STACKS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="一句话描述（这是个什么项目 / 首屏要有什么）">
            <textarea className={`${inputCls} h-20 resize-y`} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="例：HAVC 定制公司官网，首页要有公司简介、服务项目、联系方式" disabled={busy} />
          </Field>
        </>
      )}

      {phase !== 'idle' && (
        <div className={`mt-1 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${phase === 'error' ? 'bg-rose-50 text-rose-700' : phase === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
          {busy ? <Loader2 size={15} className="mt-0.5 animate-spin" /> : phase === 'done' ? <CheckCircle2 size={15} className="mt-0.5" /> : <AlertTriangle size={15} className="mt-0.5" />}
          <span className="break-all">{msg}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">{phase === 'done' ? '完成' : '取消'}</button>
        {phase !== 'done' && machines.length > 0 && (
          <button onClick={provision} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? '创建中…' : 'AI 新建'}
          </button>
        )}
      </div>
    </Modal>
  )
}
