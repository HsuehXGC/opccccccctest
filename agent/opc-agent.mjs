#!/usr/bin/env node
// ── OPC agent（本地算力）─────────────────────────────────────
// 在你的电脑上常驻，出站建立 wss 长连接到云端网关，把本机的 claude / codex CLI
// 登记为「执行器」；云端派单时在本机跑 `claude -p <prompt>` 并把输出流式回传。
// 零依赖：用 Node 20+ 内置的全局 WebSocket。
//
// 用法：  OPC_TOKEN=<enroll-token> node opc-agent.mjs
// 可选：  OPC_URL=wss://navo7.com/agent  （默认即此）

import os from 'node:os'
import { existsSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'

const URL = process.env.OPC_URL || 'wss://navo7.com/agent'
const TOKEN = process.env.OPC_TOKEN
if (!TOKEN) {
  console.error('✗ 缺少 OPC_TOKEN 环境变量（在「团队与账户 → 绑定电脑」获取）')
  process.exit(1)
}
if (typeof WebSocket === 'undefined') {
  console.error('✗ 需要 Node 20+（内置 WebSocket）。当前:', process.version)
  process.exit(1)
}

// 机器信息
function osLabel() {
  if (process.platform === 'darwin') {
    try {
      const name = execSync('sw_vers -productName', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      const ver = execSync('sw_vers -productVersion', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      return `${name} ${ver}`
    } catch {}
  }
  return `${os.type()} ${os.release()}`
}
const MACHINE = { name: os.hostname(), os: osLabel(), hostname: os.hostname() }

// 探测本机可用的 CLI 执行器
const busy = new Set() // 正在跑任务的 executorId
const binOf = {} // kind -> 可执行文件绝对路径（供 spawn 用）

// 定位 CLI：PATH → 登录 shell 的 PATH → 常见安装位置
function findBin(kind) {
  const tryCmd = (cmd) => {
    try {
      const p = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).toString().trim().split('\n')[0]
      return p && existsSync(p) ? p : null
    } catch {
      return null
    }
  }
  const home = os.homedir()
  const candidates = [
    `${home}/.local/bin/${kind}`,
    `${home}/.claude/local/${kind}`,
    '/opt/homebrew/bin/' + kind,
    '/usr/local/bin/' + kind,
    `${home}/.bun/bin/${kind}`,
    `${home}/.npm-global/bin/${kind}`,
    `${home}/.deno/bin/${kind}`,
  ]
  return (
    tryCmd(`command -v ${kind}`) || // 当前 PATH
    tryCmd(`${process.env.SHELL || '/bin/zsh'} -lc 'command -v ${kind}'`) || // 登录 shell 的 PATH
    candidates.find((c) => existsSync(c)) || // 常见位置
    null
  )
}

function detectExecutors(machineId) {
  const execs = []
  for (const kind of ['claude', 'codex']) {
    const bin = findBin(kind)
    if (!bin) continue
    binOf[kind] = bin
    let ver = kind
    try {
      ver = execSync(`"${bin}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).toString().trim().split('\n')[0]
    } catch {}
    const id = `${machineId}-${kind}`
    execs.push({ id, kind, label: `${kind} · ${ver}`, status: busy.has(id) ? 'busy' : 'idle' })
  }
  return execs
}

let machineId = null
let hb = null
let ws = null
let agentToken = null // 首次 enroll 后拿到的长期凭证，用于断线/重启后自动重连
const running = new Map() // jobId -> child process

const send = (m) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m))

function connect() {
  ws = new WebSocket(URL)

  ws.addEventListener('open', () => {
    if (agentToken) {
      console.log(`↻ 已重连 ${URL}，用长期凭证重新登记…`)
      send({ t: 'reenroll', agentToken, machine: MACHINE })
    } else {
      console.log(`→ 已连接 ${URL}，发送 enroll…`)
      send({ t: 'enroll', token: TOKEN, machine: MACHINE })
    }
  })

  ws.addEventListener('message', (ev) => {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    } catch {
      return
    }

    if (msg.error) {
      console.error('✗ 云端拒绝:', msg.error)
      // 凭证失效才退出；其余错误交给重连
      if (!agentToken || /agentToken/.test(msg.error)) process.exit(1)
      return
    }

    if (msg.t === 'enrolled') {
      machineId = msg.machineId
      if (msg.agentToken) agentToken = msg.agentToken
      if (hb) clearInterval(hb)
      const execs = detectExecutors(machineId)
      console.log(`✓ 已登记 machineId=${machineId}`)
      console.log(`✓ 探测到执行器: ${execs.map((e) => e.label).join(', ') || '（无 claude/codex）'}`)
      send({ t: 'heartbeat', machineId, executors: execs })
      hb = setInterval(() => send({ t: 'heartbeat', machineId, executors: detectExecutors(machineId) }), 20_000)
      return
    }
    if (msg.t === 'ping') {
      send({ t: 'heartbeat', machineId, executors: detectExecutors(machineId) })
      return
    }
    if (msg.t === 'job:dispatch') {
      runJob(msg)
      return
    }
    if (msg.t === 'job:cancel') {
      running.get(msg.jobId)?.kill('SIGTERM')
      return
    }
  })

  ws.addEventListener('close', () => {
    if (hb) clearInterval(hb)
    if (agentToken) {
      console.error('✗ 连接断开，5 秒后自动重连…')
      setTimeout(connect, 5000)
    } else {
      console.error('✗ 连接断开且未登记，退出。重新「绑定电脑」再启动。')
      process.exit(1)
    }
  })
  ws.addEventListener('error', (e) => console.error('✗ 连接错误:', e?.message || e))
}

connect()

// 把 claude stream-json 的一行事件渲染成可读文本（用于流式回传）
function renderClaudeEvent(ev) {
  // 逐 token 增量（--include-partial-messages）
  if (ev.type === 'stream_event') {
    const e = ev.event || {}
    if (e.type === 'content_block_delta') {
      if (e.delta?.type === 'text_delta') return e.delta.text
      if (e.delta?.type === 'thinking_delta') return e.delta.thinking || ''
    }
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
      return `\n〔🔧 ${e.content_block.name}〕\n`
    }
    return ''
  }
  return ''
}

// ── 执行一段派单 = 在对应 CLI 上跑 prompt，流式回传 ──────────
// 在 repo 里跑 git，取一行输出（失败返回空）
function git(dir, cmd) {
  try {
    return execSync(`git -C "${dir}" ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// 任务完成后，把 repo 的 git 变更（新 commit / 改动文件 / 未提交改动）汇成一段摘要
function gitSummary(dir, before) {
  const head = git(dir, 'rev-parse HEAD')
  if (!head) return '' // 不是 git 仓库
  const parts = []
  if (before && head !== before) {
    const commits = git(dir, `log --oneline ${before}..${head}`)
    const stat = git(dir, `diff --stat ${before} ${head}`)
    parts.push(`### 新提交\n${commits}\n\n### 改动文件\n${stat}`)
  }
  const dirty = git(dir, 'status --short')
  if (dirty) {
    const stat = git(dir, 'diff --stat')
    parts.push(`### 未提交的工作区改动\n${dirty}\n${stat ? '\n' + stat : ''}`)
  }
  if (!parts.length) return `\n\n---\n## GIT 变更\n（无代码改动，HEAD=${head.slice(0, 8)}）`
  return `\n\n---\n## GIT 变更\n${parts.join('\n\n')}`
}

function runJob({ jobId, kind, prompt, cwd, mode, cmd }) {
  const execId = `${machineId}-${kind}`
  busy.add(execId)
  const gitBefore = cwd ? git(cwd, 'rev-parse HEAD') : ''
  // shell 任务（构建/测试）：cmd 存在时用 bash -lc 跑命令，不跑 claude
  const isShell = !!cmd
  const bin = isShell ? 'bash' : binOf[kind] || findBin(kind) || kind
  const isClaude = !isShell && kind !== 'codex'
  // claude 用 stream-json + 部分消息拿逐 token 会话内容；
  // --dangerously-skip-permissions 绕过 headless 下的首次信任/权限提示（否则无人应答会挂起）。
  // 注：--permission-mode plan 在 headless 无人审批会挂起，故不使用；「只讨论不执行」由提示词约束。
  const args = isShell
    ? ['-lc', cmd]
    : isClaude
      ? ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--dangerously-skip-permissions']
      : ['exec', prompt]
  console.log(`▶ job ${jobId}: ${isShell ? `shell「${String(cmd).slice(0, 60)}」` : bin + (isClaude ? ` -p "${String(prompt).slice(0, 40)}…"` : ' exec')}`)

  let child
  try {
    // stdin 设为 ignore（立即 EOF），否则 claude -p 会挂起等待 stdin
    child = spawn(bin, args, { cwd: cwd || os.homedir(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    busy.delete(execId)
    send({ t: 'job:error', jobId, error: `无法启动 ${bin}: ${err.message}` })
    return
  }
  running.set(jobId, child)

  let result = '' // 最终结果（stream-json 的 result 事件；否则累积文本）
  let streamed = '' // 已流式发出的可读文本
  let buf = ''
  let stdoutBytes = 0

  function pushChunk(text) {
    if (!text) return
    streamed += text
    send({ t: 'job:chunk', jobId, stream: 'stdout', text })
  }

  child.stdout.on('data', (d) => {
    stdoutBytes += d.length
    buf += d.toString()
    if (!isClaude) {
      pushChunk(buf)
      buf = ''
      return
    }
    // 按行解析 JSONL
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        pushChunk(line + '\n') // 非 JSON（如登录提示/报错）原样透出
        continue
      }
      if (ev.type === 'result') {
        result = typeof ev.result === 'string' ? ev.result : result
      } else {
        pushChunk(renderClaudeEvent(ev))
      }
    }
  })
  child.stderr.on('data', (d) => {
    const text = d.toString()
    // shell 任务的报错多走 stderr（如 git）；累加进 streamed，失败时 tail 才有内容（否则显示「无输出」）
    if (isShell) streamed += text
    send({ t: 'job:chunk', jobId, stream: 'stderr', text })
  })
  child.on('error', (err) => {
    busy.delete(execId)
    running.delete(jobId)
    send({ t: 'job:error', jobId, error: err.message })
  })
  child.on('close', (code) => {
    busy.delete(execId)
    running.delete(jobId)
    console.log(`■ job ${jobId} 结束 exit=${code} · stdout ${stdoutBytes} 字节 · streamed ${streamed.length} · result ${result.length}`)
    let final = (result || streamed).trim()
    if (isShell) {
      // shell 任务（构建/测试）：exit 0 即成功（即使静默无输出）；非 0 = 失败，回传日志尾部
      const tail = final.slice(-4000)
      if (code === 0) send({ t: 'job:done', jobId, exitCode: 0, result: `✅ 命令成功（exit 0）\n\n${tail || '（无输出）'}` })
      else send({ t: 'job:error', jobId, error: `❌ 命令失败（exit ${code}）\n\n${tail || '（无输出）'}` })
      return
    }
    // repo 任务：把 git 变更摘要附到产出（G0.3）
    if (cwd && final) final += gitSummary(cwd, gitBefore)
    if (code === 0 && final) send({ t: 'job:done', jobId, exitCode: 0, result: final })
    else if (code === 0) send({ t: 'job:error', jobId, error: `claude 退出正常但无可解析输出（stdout ${stdoutBytes} 字节）` })
    else send({ t: 'job:error', jobId, error: final || `退出码 ${code}` })
  })
}

process.on('SIGINT', () => {
  console.log('\n收到 SIGINT，关闭 agent。')
  for (const c of running.values()) c.kill('SIGTERM')
  ws.close()
  process.exit(0)
})
