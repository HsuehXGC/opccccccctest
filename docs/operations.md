# OPC · 运维说明

## 1. 环境要求

- Node.js ≥ 22，npm ≥ 10
- 现代浏览器（前端 SPA）
- （M2/M3）云端一台可对外提供 HTTPS/WSS 的服务器；（M3）PostgreSQL、KMS/Secrets Manager

## 2. 本地开发

```bash
npm install            # 安装全部 workspace 依赖（frontend + backend）

npm run dev            # 前台 dev server → http://localhost:5173
npm run dev:api        # 另开终端，后端 → http://localhost:8787
```

- 前端 dev server 已把 `/api` 代理到 `http://localhost:8787`（见 `frontend/vite.config.ts`）
- **M1 前台无需后端**即可体验全部流程（浏览器内 mock 数据 + 模拟执行引擎）；
  侧边栏「执行引擎」可暂停/启动模拟

## 3. 构建

```bash
npm run build          # 前端类型检查 + 生产构建，产物在 frontend/dist/
```

- 后端：`npm run start --workspace backend`（Node 直接跑 TS，`--experimental-strip-types`），
  或 `npm run dev:api`（tsx watch）

## 4. 部署

| 组件 | 方式 |
| --- | --- |
| 前端 | 静态托管 / CDN（`frontend/dist/`）。SPA，配置 fallback 到 `index.html` |
| 后端 API + Agent 网关 | Node 服务，置于反向代理（Nginx/Caddy）后，暴露 HTTPS + WSS（`/agent`） |
| 数据库（M3） | PostgreSQL，见[数据库设计](database.md) |
| 密钥（M3） | KMS / Secrets Manager 存 agentToken 与 claude/codex 敏感凭证 |

网关需支持大量常驻 WSS 长连接（每台用户机器一条）；按连接数做水平扩展与会话粘性/共享注册表。

## 5. 环境变量

| 变量 | 组件 | 说明 |
| --- | --- | --- |
| `PORT` | backend | 后端监听端口（默认 8787） |
| `CLAUDE_BIN` | agent（规划） | claude 可执行文件路径（默认 `claude`） |
| `DATABASE_URL` | backend（M3） | PostgreSQL 连接串 |
| `OPC_TOKEN` | agent 安装 | 一次性 enroll token，注入安装命令 |

## 6. Agent 分发与安装

用户在「团队与账户 → 绑定电脑」获取一行安装命令（含一次性 token）：

```bash
# macOS / Ubuntu
curl -fsSL https://get.opc.dev/install.sh | OPC_TOKEN=<token> sh

# Windows (PowerShell)
$env:OPC_TOKEN="<token>"; irm https://get.opc.dev/install.ps1 | iex
```

安装脚本应：
1. 落地跨平台单二进制 agent，注册为 OS 服务（launchd / systemd / Windows 服务），开机自启
2. agent 用 token 出站 `enroll`，换取长期 agentToken 持久化到本机安全存储
3. 探测本机 claude / codex 账户，`heartbeat` 上报为执行器
4. 保持常驻 WSS 连接，接收派单、跑 `claude -p`、流式回传

**网络**：只需**出站** 443；无需公网 IP、无需在用户机器上开入站端口或暴露 SSH。

## 7. 监控与健康检查

- `GET /api/health` → 服务状态 + 在线 agent 数
- `GET /api/machines` → 在线机器与执行器
- 关注指标：在线 agent 数、派单成功率、job 时延、SSE 连接数

## 8. 安全运维

- **enroll token**：一次性、短时效（默认 15 分钟），用后作废
- **最小权限**：仅允许云端→机器单向派单，限定可执行范围（非裸 shell）
- **凭证**：agentToken 与敏感凭证进 KMS，不明文长期落库
- **吊销**：撤销机器 = 作废 agentToken 并断开连接；撤销成员账户即时生效
- **租户隔离**：内容按 org/project 作用域；建议数据库 RLS
- **审计**：记录派单、登录、凭证签发/吊销

## 9. 备份与恢复（M3）

- PostgreSQL 定期快照 + WAL 归档
- 密钥托管在 KMS，随其备份/轮换策略
- 前端为无状态静态资源，随构建产物版本化

## 10. 故障排查

| 现象 | 排查 |
| --- | --- |
| 机器显示离线 | agent 服务是否运行；出站 443 是否被防火墙/代理拦截 |
| 派单 409「执行器不在线」 | 目标执行器所在机器是否在线、心跳是否正常 |
| 看板无实时日志 | `/api/stream` SSE 是否连通；网关是否收到 `job:chunk` |
| 绑定电脑后无执行器 | agent 是否探测到本机 claude/codex 账户 |
