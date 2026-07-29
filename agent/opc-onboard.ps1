# ── OPC 一键接入（Windows）─────────────────────────────────────
# 在一台 Windows 上跑一条命令，把它变成 OPC 的「本地算力」：
#   勘察系统 → 缺 Node/claude 就装（免管理员，装进 %LOCALAPPDATA%\opc）→ claude 登录（你点一下）
#   → 下载 opc-agent → 注册成登录自启的计划任务 → 起来自动接入云端。
#
# 用法（PowerShell）：
#   $env:OPC_TOKEN="<绑定token>"; irm https://navo7.com/opc-onboard.ps1 | iex
#
# 可选环境变量：
#   OPC_ORIGIN    云端根地址，默认 https://navo7.com
#   OPC_NAME      给这个 agent 起名（同机多角色时用；默认用主机名）
#   OPC_NODE_VER  需自装 Node 时的版本，默认 v20.18.1
#   OPC_WITH_SSH  设为 1 则额外配 OpenSSH 兜底（需管理员，见末尾）

$ErrorActionPreference = 'Stop'
# 默认执行策略（Restricted/AllSigned）会拦 npm.ps1 / claude.ps1 等 .ps1 垫片。
# 进程级 Bypass：只影响本次会话、免管理员，装完即失效。
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue } catch {}

$Origin  = if ($env:OPC_ORIGIN) { $env:OPC_ORIGIN } else { 'https://navo7.com' }
$Token   = $env:OPC_TOKEN
$Name    = $env:OPC_NAME
$NodeVer = if ($env:OPC_NODE_VER) { $env:OPC_NODE_VER } else { 'v22.11.0' }
$Wss     = ($Origin -replace '^http', 'ws') + '/agent'
$OpcHome = Join-Path $env:LOCALAPPDATA 'opc'
$Suffix  = if ($Name) { '-' + ($Name -replace '[^A-Za-z0-9]+','-').Trim('-') } else { '' }

function Say($m){ Write-Host "› $m" -ForegroundColor Cyan }
function OK ($m){ Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m){ Write-Host "! $m" -ForegroundColor Yellow }
function Die($m){ Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

Write-Host "`n── OPC 一键接入（Windows）─────────────────────────`n" -ForegroundColor Magenta

# ── 0. 前置 ────────────────────────────────────────────────
if (-not $Token) { Die "缺少 OPC_TOKEN。请在网页「团队与账户 → 本地算力 → 绑定电脑」复制命令。" }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
Say "系统：Windows/$arch · 主机名 $env:COMPUTERNAME"
New-Item -ItemType Directory -Force -Path $OpcHome | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 后续 Node/npm/claude 都优先走自装目录（免管理员）
$NodeDir = Join-Path $OpcHome 'node'
$NpmPrefix = Join-Path $OpcHome 'npm-global'
$env:npm_config_prefix = $NpmPrefix
$env:PATH = "$NodeDir;$NpmPrefix;$env:PATH"
New-Item -ItemType Directory -Force -Path $NpmPrefix | Out-Null

# ── 1. Node ≥ 20 ───────────────────────────────────────────
function NodeMajor {
  try { (& node -v) -replace '^v','' -replace '\..*','' } catch { '0' }
}
if ((Get-Command node -ErrorAction SilentlyContinue) -and ([int](NodeMajor) -ge 22)) {
  OK "已有 Node $(& node -v)"
} else {
  Say "未检测到 Node 22+，装一个本地版到 $NodeDir（免管理员）…"
  $zip = "node-$NodeVer-win-$arch.zip"
  $url = "https://nodejs.org/dist/$NodeVer/$zip"
  $tmp = Join-Path $env:TEMP $zip
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  $ext = Join-Path $env:TEMP "node-$NodeVer-win-$arch"
  if (Test-Path $ext) { Remove-Item -Recurse -Force $ext }
  Expand-Archive -Path $tmp -DestinationPath $env:TEMP -Force
  Move-Item $ext $NodeDir
  Remove-Item $tmp -Force
  if (-not ((Get-Command node -ErrorAction SilentlyContinue) -and ([int](NodeMajor) -ge 22))) {
    Die "Node 安装后仍不可用，请手动装 Node 22+ 后重试。"
  }
  OK "已装 Node $(& node -v)"
}

# ── 2. claude CLI ──────────────────────────────────────────
if (Get-Command claude -ErrorAction SilentlyContinue) {
  OK "已有 claude（$((& claude.cmd --version) 2>$null | Select-Object -First 1)）"
} else {
  Say "安装 claude CLI（@anthropic-ai/claude-code）…"
  # 走 npm.cmd（不受执行策略约束，规避 npm.ps1 被 GPO 拦）
  & npm.cmd install -g '@anthropic-ai/claude-code' 2>&1 | Out-Null
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Die "npm 安装 claude 失败，请检查网络后重试。" }
  OK "已装 claude"
}

# ── 3. claude 登录（你点一下）──────────────────────────────
Say "检查 claude 登录状态…"
$loggedIn = $false
try { & claude.cmd -p "reply with the single word OK" *>$null; if ($LASTEXITCODE -eq 0) { $loggedIn = $true } } catch {}
if ($loggedIn) {
  OK "claude 已登录，可直接干活"
} else {
  Warn "claude 尚未登录。浏览器会弹出授权页，同意即可（完成后回到这个窗口）。"
  try { & claude.cmd login } catch { Warn "claude login 未完成——先继续装服务，稍后可再跑 'claude login' 补登录。" }
}

# ── 4. 下载 opc-agent ──────────────────────────────────────
Say "下载 opc-agent…"
Invoke-WebRequest -Uri "$Origin/opc-agent.mjs" -OutFile (Join-Path $OpcHome 'opc-agent.mjs') -UseBasicParsing
OK "opc-agent 就位：$OpcHome\opc-agent.mjs"

# 启动器 .cmd：固化 PATH + token + url（+ 可选名字），计划任务/手动都用它
$NodeExe = (Get-Command node).Source
$RunCmd = Join-Path $OpcHome "run-agent$Suffix.cmd"
$nameLine = if ($Name) { "set `"OPC_NAME=$Name`"" } else { '' }
@"
@echo off
set "PATH=$NodeDir;$NpmPrefix;%PATH%"
set "OPC_TOKEN=$Token"
set "OPC_URL=$Wss"
$nameLine
"$NodeExe" "$OpcHome\opc-agent.mjs"
"@ | Set-Content -Path $RunCmd -Encoding ASCII

# ── 5. 注册成登录自启的计划任务（免管理员）────────────────
$TaskName = "OPC Agent$Suffix"
Say "注册计划任务 $TaskName（登录自启、崩溃自拉起）…"
$action  = New-ScheduledTaskAction -Execute $RunCmd
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -RunLevel Limited | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  OK "已注册计划任务 $TaskName"
} catch {
  Warn "注册计划任务失败（$($_.Exception.Message)）；改为本次前台启动（重启后需重跑本脚本）。"
  Start-Process -FilePath $RunCmd -WindowStyle Hidden
}

# ── 6. 等待接入确认 ────────────────────────────────────────
Say "等待接入云端…"
$connected = $false
for ($i=0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 2
  # agent 无日志文件，直接问云端不便；这里给足时间由用户在网页确认
}
Write-Host ""
OK "安装完成。回到网页「团队与账户 → 本地算力」，几秒内应能看到本机上线；点执行器「测试」验证。"
Write-Host "  停止：Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" -ForegroundColor DarkGray
Write-Host "  同机再装一个角色：先 `$env:OPC_NAME='别的名字' 再重跑本命令" -ForegroundColor DarkGray

# ── 7.（可选）SSH 兜底 ─────────────────────────────────────
# 设 OPC_WITH_SSH=1 才执行。开 OpenSSH Server 需管理员——非管理员会跳过并提示。
if ($env:OPC_WITH_SSH -eq '1') {
  Write-Host "`n── SSH 兜底 ──" -ForegroundColor Magenta
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Warn "开启 OpenSSH Server 需要管理员。请『以管理员身份』重开 PowerShell，设 `$env:OPC_WITH_SSH='1' 与 `$env:OPC_TOKEN 后重跑本脚本；或手动在『设置→系统→可选功能』装 OpenSSH 服务器。"
  } else {
    Say "启用 OpenSSH Server…"
    try {
      Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
      Set-Service sshd -StartupType Automatic
      Start-Service sshd
      OK "OpenSSH Server 已启用并运行（端口 22）"
    } catch { Warn "启用 OpenSSH Server 失败：$($_.Exception.Message)" }
    # 为反向隧道生成一把密钥（连回云端用），并把公钥打印出来
    $key = Join-Path $OpcHome 'tunnel_key'
    if (-not (Test-Path $key)) { & ssh-keygen -t ed25519 -N '""' -f $key -q }
    OK "隧道密钥已生成：$key"
    Write-Host "  这台机的隧道公钥（发给 OPC 侧授权到云端跳板即可打通反向隧道）：" -ForegroundColor DarkGray
    Get-Content "$key.pub"
    Warn "反向隧道的云端授权与端口分配由 OPC 侧完成——agent 连上后我们会读取此公钥、加到云端并起隧道任务。"
  }
}
