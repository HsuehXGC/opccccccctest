# OPC 自主化 Backlog（Gap 0–4）

目标：让 OPC 从"规划+写手"进化为"工程师+发布者+项目大脑"——自主一轮轮推进真实项目、
定期发测试版本，真人只 review 已发布版本并与虚拟团队讨论把控。

**试点项目**：VioraAI BREDE（Spring Boot 3.2.3 / Java 17 / Maven，B 端 AI 风险分析 API）
· repo `github.com/HsuehXGC/vioraai-demo` · 本地 `/Users/hsueh/VioraAI V3 Demo/`
· 执行器：本开发机（需 Java17+Maven+已认证 claude）

图例：🔲 待办 · 🔵 进行中 · ✅ 完成 · ⛔ 阻塞

---

## Gap 0 — 真实仓库执行（地基：产出软件而非文字）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| G0.0 | 执行器环境就绪 | 本机 Java17 ✅ + Maven ✅ + VioraAI 编译通过 ✅；**claude 无头认证待你做（401）** | ⛔ 等 claude 认证 |
| G0.1 | 项目接入真实工作区 | Project.workspace（repo/分支/build/test/run/env）+ Account 配置弹窗 + VioraAI 预设 | ✅ |
| G0.2 | 任务派单带 cwd（工作区） | job 带 cwd + **target_machine 定向到有 repo 的机器**；claude 在真实 repo 改文件 | ✅ |
| G0.3 | 代码任务产出=git 提交 | agent 抓 git before/after，把新 commit/改动文件附到产出（实测干净单文件提交） | ✅ |
| G0.4 | 任务隔离（分支/worktree） | 代码任务提示词先切 `opc/<taskId>` 分支再改再提交（主干不被污染）；worktree 待做 | 🔵 分支已做 |

**Gap 0 已达 DoD**：实测给 VioraAI 派任务 → bot 在 repo 真改代码 → 干净 commit → OPC 看到 diff。
**试点抓到的护栏**（记 Gap 4）：`git add -A` 会误提交未跟踪的大文件 → 提示词已改为「只 add 本次改动的具体文件」。执行器必须按机器名定向。

**验收（Gap 0 DoD）**：给 VioraAI 派一个小 feature 任务 → bot 在 repo 真改代码 → 产生一个 commit → OPC 能看到 diff。

---

## Gap 1 — 自主迭代循环（项目大脑 / autopilot）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| G1.1 | 目标/里程碑 | 自驾以「本轮目标」驱动；跨轮 round 递增、带上轮反馈；里程碑/路线图待深化 | 🔵 |
| G1.2 | Sprint 迭代状态机 | iterations 表：planning→executing→qa→integrating→building→testing→releasing→awaiting_review | ✅ |
| G1.3 | 规划 agent（大脑） | planPrompt 在真实 repo 里读代码 → 输出本轮 1-2 个小任务（TASK: 标题｜角色｜做什么）| ✅ |
| G1.4 | autopilot 常驻驱动器 | autopilot.ts drive()：规划→并发执行→QA→集成→构建→测试→发布，全用 job 系统串起、后端常驻 | ✅ |

**验收达成**：给 VioraAI 一句目标，OPC **全自主**跑完 规划→写代码(2任务2分支)→QA(2通过)→集成→构建→测试→发布 v2-711-2125，全程无人点按钮，产出真实 commit + 版本。

---

## Gap 2 — 构建→测试→发布 流水线（交付）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| G2.1 | 构建 job | shell job（agent 支持 bash -lc）；「构建测试版本」按钮跑 build 命令，捕获成败+日志。实测 VioraAI `mvn package` BUILD SUCCESS | ✅ |
| G2.2 | 测试 job + QA 门禁 | 「跑测试」按钮（shell job，mvn test）；「AI 复核」按钮=QA bot 对照要求判定 VERDICT PASS/FAIL，PASS 自动通过、FAIL 留待人工。实测 QA 精准驳回错配任务 | ✅ |
| G2.3 | 集成/合并 | 「集成」按钮：从 base 建 opc/integration，依次 merge 各 done 任务的 opc/<taskId> 分支，冲突则跳过并报告。实测合并 2 分支无冲突、内容齐 | ✅ |
| G2.4 | 发布=版本+changelog+预览 | 「发布测试版本」按钮：在 opc/integration 上出版本号+changelog(base..HEAD)+构建产物+打 tag；新增「发布」视图 review 已发布版本(版本/changelog/产物/运行预览)。实测 test-rel-01 全链路 | ✅ |
| G2.5 | 发布触发器 | 达标即发 / 定时发（并入 Gap 1 autopilot：每轮达标自动发） | 🔲 |

**验收**：一轮结束后 OPC 自动出一个"测试版本"——有版本号、changelog、能跑/能试。

---

## Gap 3 — 面向发布版本的人工评审（替代任务级）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| G3.1 | 放开任务级人工门禁 | 任务经自验证后自动通过，不再需要人点复核（循环无人值守） | 🔲 |
| G3.2 | 发布评审面板 | 发版即通知你；展示版本+changelog+改动+预览；你留反馈（通过/打回/意见） | 🔲 |
| G3.3 | 反馈→下一轮 | 你的反馈进 backlog / 触发 steering 会议消化成任务 | 🔲 |

**验收**：任务级你完全不碰；发版后你 review + 开会给反馈 → 下一轮据此调整。

---

## Gap 4 — 无人值守护栏 & 决策质量

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| G4.1 | 自我验证 / 对抗式 QA | 任务/发布前"这真满足需求吗"门禁（多轮/对抗，复用 QA 报告验证过的模式） | 🔲 |
| G4.2 | 失败升级 | 反复失败→重规划或标记阻塞升级给人，不默默重试 | 🔲 |
| G4.3 | 预算/轮次上限 | 每项目成本/迭代闸 | 🔲 |
| G4.4 | 决策日志 | 每轮 autopilot 决策+理由，可审计，供 steering 看 | 🔲 |
| G4.5 | 跨轮记忆 | 决策/教训/架构沉淀，回喂后续 prompt，不每轮重推 | 🔲 |

**验收**：无人盯着时 OPC 能抓自己的错、卡住会升级、决策可追溯。

---

## 执行顺序

先把 **Gap 0 全打通**（能真改代码），再 **Gap 2 最小版**（能出测试版本），
再 **Gap 1**（自驾循环串起来），再 **Gap 3**（发布级评审闭环），Gap 4 贯穿加固。
每完成一项，用 VioraAI 加一个小 feature 验证 OPC 是否真的产出了生产力。
