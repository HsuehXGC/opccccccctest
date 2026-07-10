# OPC · 架构文档

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器 · 前端 SPA (Vite + React + Zustand)                   │
│  账户/项目 · 需求 · 文档Wiki · 任务看板 · 虚拟人力 · 绑定电脑  │
└───────────────┬─────────────────────────────────────────────┘
                │ REST / SSE (M2)
┌───────────────▼─────────────────────────────────────────────┐
│  云端后端 (Node + Express)                                    │
│  ┌─────────────┐   ┌──────────────────────────────────────┐  │
│  │ REST API    │   │ AgentGateway                         │  │
│  │ 派单/查询   │◄─►│ 管理 agent 连接 · 注册 · 心跳 · 派单  │  │
│  └─────────────┘   └───────────────┬──────────────────────┘  │
└────────────────────────────────────┼─────────────────────────┘
                                     │ 常驻 WSS（agent 出站发起）
        ┌────────────────────────────┼────────────────────────┐
        ▼                            ▼                         ▼
┌───────────────┐          ┌───────────────┐         ┌───────────────┐
│ 内网机器 Mac  │          │ 内网机器 Ubuntu│         │ 内网机器 Win  │
│ OPC agent     │          │ OPC agent     │         │ OPC agent     │
│ ├ claude 执行器│          │ ├ claude 执行器│         │ ├ claude 执行器│
│ └ codex 执行器 │          │ └ codex 执行器 │         │ └ codex 执行器 │
└───────────────┘          └───────────────┘         └───────────────┘
```

核心约束：**内网机器无公网 IP，云端无法主动连入**。因此由机器上的 agent
**主动出站**建立常驻连接，所有派单顺着这条已建立的连接回传。

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vite 6 · React 18 · TypeScript 5 · Tailwind CSS v4 · Zustand 5 · marked |
| 后端 | Node 22 · Express 4 · TypeScript（tsx 运行） |
| Agent（规划） | 跨平台单二进制（Go / Rust）+ OS 服务（launchd / systemd / Windows 服务） |
| 传输 | 出站 WSS（agent → 云端）；SSH 作为可选通用通道后续叠加 |

Monorepo（npm workspaces）：`frontend/` + `backend/`。

## 3. 前端分层

- **视图层** `frontend/src/views/`：Dashboard / ProductWorkspace / Wiki / Kanban / Workforce / Account
- **状态层** `frontend/src/store/useStore.ts`：单一 Zustand store，含全部领域数据（M1 为 mock 种子）
  与 actions；导航 `view` / `focusDoc` 也在 store 里以支持跨模块深链
- **领域模型** `frontend/src/types.ts`：所有实体类型定义
- **Mock 数据** `frontend/src/mock/`：种子数据 + 模拟执行引擎（每 1.5s 推进任务进度、滚动日志）

> M1 前端不依赖后端即可跑通全部流程；M2 把 store 的派单/执行相关 action 改为调用后端 + SSE。

## 4. 多租户模型

```
Account（Root + 成员，同一 orgId 构成账户组）
  └── Project（orgId 作用域，账户组共享）        ← 顶层租户边界
        └── Product（projectId）                  ← 内容根、文档树命名空间
              ├── Requirement（productId）
              ├── WikiDoc（productId, 版本/关系）
              └── Task（productId, requirementId）
  └── Bot（账户组级共享，跨项目）
  └── Machine（accountId）→ Executor（machineId, claude/codex）
```

- 作用域锚点是 **Product.projectId**：需求/文档/任务都经产品归属项目，切项目即换整套内容
- 虚拟人力（Bot）与本地算力（Machine/Executor）属账户组，跨项目共享

## 5. 关键数据流

### 5.1 需求 → 文档 / 任务
需求以 Markdown 正文承载，`[[slug]]` 关联产品文档；文档蓝图算出核心文档缺口。
需求可拆解为任务（`Task.requirementId`）。

### 5.2 文档：类型化关系 + 混合版本
- `WikiDoc.relations`：结构化上下游（派生/实现/验证/决策/引用），供蓝图与编排使用
- `WikiDoc.versions[]`：newest-first 版本快照，每个快照标注所服务的产品版本（混合版本模型）

### 5.3 任务执行闭环
```
Task.brief ──► 绑定的 Executor（某机器上的 claude/codex）
   │            └─ AgentGateway.dispatch()（M2）
   ▼
机器上 agent 跑 claude -p <brief> ──► 输出经 WSS 流回 ──► SSE ──► 看板实时日志
   │
   └─ 文档任务完成 → 目标文档生成新版本（交付物闭环，见 moveTask）
```

## 6. 内网接入架构（Agent 网关）

详见[接口文档](api.md)与 `backend/src/agentGateway.ts` / `agentProtocol.ts`。

1. **签发 token**：云端为账户签发一次性、短时效 enroll token（放进"绑定电脑"的安装命令）
2. **注册**：agent 拿 token 出站接入，换取长期 agentToken + machineId
3. **心跳**：agent 周期上报机器上探测到的 claude/codex 执行器
4. **派单**：`gateway.dispatch(executorId, prompt)` 找到承载该执行器的机器连接，下发 job
5. **回传**：agent 流式回传 `job:chunk / done / error`，网关经 SSE 广播给前端

`AgentGateway` 是**传输无关**的——把一条已建立的连接包成 `AgentConnection` 交进来即可；
真实 WebSocket 服务器在 M2 挂到 `/agent`。

## 7. 三个执行接缝（为编排预留）

系统在三处留好了对接真实执行/工作流的接缝：

1. **文档蓝图缺口**：产品应有哪些文档 vs 现有 → 差集 = 待办
2. **任务执行简报** `Task.brief`：给员工的指令 = `claude -p` 的输入
3. **Agent 网关** `AgentGateway.dispatch()`：把简报送到具体执行器

## 8. 目录结构

```
opc/
├── docs/                     # 本文档集
├── frontend/                 # Vite + React 前台
│   └── src/
│       ├── views/            # 六大视图
│       ├── store/useStore.ts # Zustand 单一 store
│       ├── types.ts          # 领域模型
│       ├── mock/             # 种子数据 + 模拟引擎
│       ├── lib/              # UI 基元、markdown 渲染
│       └── components/       # Modal 等
└── backend/                  # Express 后端
    └── src/
        ├── index.ts          # REST / SSE 入口
        ├── agentGateway.ts   # Agent 连接网关
        └── agentProtocol.ts  # Agent 协议消息类型
```
