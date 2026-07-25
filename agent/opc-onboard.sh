#!/usr/bin/env bash
# ── OPC 一键接入 ─────────────────────────────────────────────
# 在一台全新的 Mac / Linux 上跑一条命令，自动把它变成 OPC 的「本地算力」：
#   勘察系统 → 缺 node/claude 就装（免 sudo，装进 ~/.opc）→ claude 登录（你点一下）
#   → 下载 opc-agent → 装成常驻服务（macOS launchd / Linux systemd）→ 起来自动接入云端。
#
# 用法（务必「下载后再跑」，保留终端 TTY 给 claude 登录用）：
#   curl -fsSL https://navo7.com/opc-onboard.sh -o /tmp/opc-onboard.sh \
#     && OPC_TOKEN=<绑定token> bash /tmp/opc-onboard.sh
#
# 可选环境变量：
#   OPC_ORIGIN   云端根地址，默认 https://navo7.com
#   OPC_NODE_VER 需要自装 node 时的版本，默认 v20.18.1
set -euo pipefail

OPC_ORIGIN="${OPC_ORIGIN:-https://navo7.com}"
OPC_HOME="${OPC_HOME:-$HOME/.opc}"
NODE_VER="${OPC_NODE_VER:-v20.18.1}"
WSS_URL="$(printf '%s' "$OPC_ORIGIN" | sed 's#^http#ws#')/agent"
# OPC_NAME：给这个 agent 起个名（默认用主机名）。同一台机器想跑多个 agent
# （如 mini 上「集成」+「测试」两个角色）时，用不同 OPC_NAME 各装一份即可。
OPC_NAME="${OPC_NAME:-}"
# 服务名后缀：具名安装时带上，避免同机多个 agent 的服务互相覆盖
SVC_SUFFIX=""
[ -n "$OPC_NAME" ] && SVC_SUFFIX="-$(printf '%s' "$OPC_NAME" | tr -c 'a-zA-Z0-9' '-' | sed 's/-\{2,\}/-/g;s/^-//;s/-$//')"

# ── 小工具：彩色日志 ─────────────────────────────────────────
c()   { printf '\033[%sm%s\033[0m' "$1" "$2"; }
say() { printf '%s %s\n' "$(c '36;1' '›')" "$1"; }
ok()  { printf '%s %s\n' "$(c '32;1' '✓')" "$1"; }
warn(){ printf '%s %s\n' "$(c '33;1' '!')" "$1"; }
die() { printf '%s %s\n' "$(c '31;1' '✗')" "$1" >&2; exit 1; }

printf '\n%s\n\n' "$(c '35;1' '── OPC 一键接入 ──────────────────────────')"

# ── 0. 前置检查 ─────────────────────────────────────────────
[ -n "${OPC_TOKEN:-}" ] || die "缺少 OPC_TOKEN。请在网页「团队与账户 → 本地算力 → 绑定电脑」复制一键接入命令。"
command -v curl >/dev/null 2>&1 || die "缺少 curl，请先安装 curl。"

UNAME_S="$(uname -s)"; UNAME_M="$(uname -m)"
case "$UNAME_S" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) die "暂不支持的系统：$UNAME_S（仅 macOS / Linux）" ;;
esac
case "$UNAME_M" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  armv7l)        ARCH=armv7l ;;
  *) die "暂不支持的架构：$UNAME_M" ;;
esac
say "系统：$OS/$ARCH · 主机名 $(hostname)"
mkdir -p "$OPC_HOME"

# 后续所有 node/npm/claude 都优先走我们自己装的目录，免 sudo
export NPM_CONFIG_PREFIX="$OPC_HOME/npm-global"
export PATH="$OPC_HOME/node/bin:$NPM_CONFIG_PREFIX/bin:$HOME/.local/bin:$PATH"
mkdir -p "$NPM_CONFIG_PREFIX/bin"

# ── 1. Node ≥ 20 ────────────────────────────────────────────
node_major() { node -v 2>/dev/null | sed 's/^v//;s/\..*//'; }
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 20 ] 2>/dev/null; then
  ok "已有 Node $(node -v)"
else
  say "未检测到 Node 20+，装一个本地版到 $OPC_HOME/node（免 sudo）…"
  TARBALL="node-${NODE_VER}-${OS}-${ARCH}.tar.gz"
  URL="https://nodejs.org/dist/${NODE_VER}/${TARBALL}"
  TMP="$(mktemp -d)"
  curl -fsSL "$URL" -o "$TMP/$TARBALL" || die "下载 Node 失败：$URL"
  rm -rf "$OPC_HOME/node"; mkdir -p "$OPC_HOME/node"
  tar -xzf "$TMP/$TARBALL" -C "$OPC_HOME/node" --strip-components=1
  rm -rf "$TMP"
  command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 20 ] 2>/dev/null \
    || die "Node 安装后仍不可用，请手动安装 Node 20+ 后重试。"
  ok "已装 Node $(node -v)"
fi

# ── 2. claude CLI ───────────────────────────────────────────
if command -v claude >/dev/null 2>&1; then
  ok "已有 claude（$(claude --version 2>/dev/null | head -1)）"
else
  say "安装 claude CLI（@anthropic-ai/claude-code）…"
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || die "npm 安装 claude 失败，请检查网络后重试。"
  command -v claude >/dev/null 2>&1 || die "claude 安装后仍不在 PATH。"
  ok "已装 claude（$(claude --version 2>/dev/null | head -1)）"
fi

# ── 3. claude 登录（你点一下）───────────────────────────────
say "检查 claude 登录状态…"
if claude -p "reply with the single word OK" >/dev/null 2>&1; then
  ok "claude 已登录，可直接干活"
else
  if [ -t 0 ]; then
    warn "claude 尚未登录。这一步需要你点一下：浏览器会弹出授权页，同意即可。"
    printf '   %s\n' "$(c '90' '（完成后回到这个终端，脚本会自动继续）')"
    claude login || warn "claude login 未完成——先继续装服务，稍后可再跑 'claude login' 补登录。"
    claude -p "reply with the single word OK" >/dev/null 2>&1 && ok "claude 登录成功" || warn "仍未登录，agent 会先接入但暂无 claude 执行器。"
  else
    warn "未连接到终端（TTY），无法自动拉起登录。请在这台机器上手动跑一次： claude login"
  fi
fi

# ── 4. 下载 opc-agent ───────────────────────────────────────
say "下载 opc-agent…"
curl -fsSL "$OPC_ORIGIN/opc-agent.mjs" -o "$OPC_HOME/opc-agent.mjs" || die "下载 opc-agent.mjs 失败"
ok "opc-agent 就位：$OPC_HOME/opc-agent.mjs"

# 启动器：固化 PATH + token + url（+ 可选名字），服务/手动都用它
NODE_BIN="$(command -v node)"
RUN_SH="$OPC_HOME/run-agent${SVC_SUFFIX}.sh"
LOG="$OPC_HOME/agent${SVC_SUFFIX}.log"
cat > "$RUN_SH" <<EOF
#!/usr/bin/env bash
export PATH="$OPC_HOME/node/bin:$NPM_CONFIG_PREFIX/bin:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export OPC_TOKEN="$OPC_TOKEN"
export OPC_URL="$WSS_URL"
${OPC_NAME:+export OPC_NAME="$OPC_NAME"}
exec "$NODE_BIN" "$OPC_HOME/opc-agent.mjs"
EOF
chmod +x "$RUN_SH"

# ── 5. 装成常驻服务 ─────────────────────────────────────────
if [ "$OS" = darwin ]; then
  LABEL="com.opc.agent${SVC_SUFFIX}"
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>$RUN_SH</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST" || die "launchctl load 失败"
  ok "已装 launchd 常驻服务 ${LABEL}（开机自启、崩溃自拉起）"
  SVC_TIP="查看日志： tail -f $LOG    停止： launchctl unload $PLIST"
else
  # Linux：优先 systemd --user
  UNIT="opc-agent${SVC_SUFFIX}"
  if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    UNIT_DIR="$HOME/.config/systemd/user"; mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/${UNIT}.service" <<EOF
[Unit]
Description=OPC local compute agent${SVC_SUFFIX:+ ($OPC_NAME)}
After=network-online.target
[Service]
ExecStart=$RUN_SH
Restart=always
RestartSec=5
StandardOutput=append:$LOG
StandardError=append:$LOG
[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now "${UNIT}.service" || die "systemctl --user enable 失败"
    loginctl enable-linger "$USER" >/dev/null 2>&1 || warn "无法开启 linger，注销后服务可能停止（可跑： sudo loginctl enable-linger $USER）"
    ok "已装 systemd --user 常驻服务 ${UNIT}（开机自启、崩溃自拉起）"
    SVC_TIP="查看日志： journalctl --user -u ${UNIT} -f   或  tail -f $LOG"
  else
    # 兜底：nohup 后台
    warn "无 systemd --user，改用 nohup 后台运行（重启后需重跑本脚本）。"
    pkill -f "OPC_NAME=$OPC_NAME.*opc-agent.mjs" >/dev/null 2>&1 || true
    nohup "$RUN_SH" >"$LOG" 2>&1 &
    ok "已在后台启动 opc-agent（nohup）"
    SVC_TIP="查看日志： tail -f $LOG    停止： pkill -f run-agent${SVC_SUFFIX}.sh"
  fi
fi

# ── 6. 等待接入确认 ─────────────────────────────────────────
say "等待接入云端…"
CONNECTED=""
for i in $(seq 1 10); do
  sleep 2
  if grep -q "已登记 machineId" "$LOG" 2>/dev/null; then CONNECTED=1; break; fi
done
printf '\n'
if [ -n "$CONNECTED" ]; then
  ok "$(c '32;1' '接入成功！') 这台机器已作为本地算力上线。回到网页「本地算力」即可看到它。"
else
  warn "还没看到接入确认。服务已装好，通常几秒内会自动连上；若一直没有，看日志排查。"
fi
printf '   %s\n\n' "$(c '90' "$SVC_TIP")"
