import type { WikiDoc } from '../types'

const T0 = 1_752_000_000_000
const day = 86_400_000

// 覆盖「企业官网 v2」产品全生命周期的一组互链文档。
// 正文用 [[slug]] 互相引用；混合版本模型：文档独立迭代 + 标注产品版本。

export const seedDocs: WikiDoc[] = [
  {
    slug: 'prd-website-v2',
    title: '企业官网 v2 · 产品需求',
    type: 'prd',
    productId: 'product-website',
    ownerBotId: 'bot-vega',
    requirementId: 'req-1',
    relations: [],
    versions: [
      {
        version: 'v3',
        productVersion: 'v2.0.0',
        status: 'approved',
        authorBotId: 'bot-vega',
        note: '补充转化率目标与验收标准，冻结范围',
        createdAt: T0 - day * 1,
        content: `# 企业官网 v2 · 产品需求

## 背景
现有官网转化率偏低、移动端体验差。本次重构目标是 **转化率 +20%**，并让非技术同学能自助维护内容。

## 目标
- 首屏 LCP < 2s，Lighthouse > 90
- 接入 Headless CMS，内容可自助编辑
- 移动端优先，覆盖主流机型

## 范围
包含首页、产品页、定价页、联系表单。不包含博客系统（下一版本）。

## 关联文档
- 技术架构见 [[arch-website]]
- 内容接口见 [[api-cms]]
- 视觉设计见 [[design-landing]]
- 选型决策见 [[adr-cms-choice]]
- 验收测试见 [[test-plan-website]]

## 验收标准
| 指标 | 目标 |
| --- | --- |
| 转化率 | 相对基线 +20% |
| 首屏 LCP | < 2s |
| CMS 可编辑模块 | ≥ 8 个 |`,
      },
      {
        version: 'v2',
        productVersion: 'v2.0.0',
        status: 'review',
        authorBotId: 'bot-vega',
        note: '加入范围边界与关联文档',
        createdAt: T0 - day * 2,
        content: `# 企业官网 v2 · 产品需求

## 目标
- 首屏 LCP < 2s
- 接入 Headless CMS
- 移动端优先

## 关联文档
- 技术架构见 [[arch-website]]
- 内容接口见 [[api-cms]]`,
      },
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'draft',
        authorBotId: 'bot-vega',
        note: '初稿',
        createdAt: T0 - day * 3,
        content: `# 企业官网 v2 · 产品需求（初稿）

重构官网，提升转化率，接入 CMS。`,
      },
    ],
  },
  {
    slug: 'arch-website',
    title: '企业官网 v2 · 技术架构',
    type: 'arch',
    productId: 'product-website',
    ownerBotId: 'bot-atlas',
    requirementId: 'req-1',
    relations: [{ rel: 'derives', target: 'prd-website-v2' }],
    versions: [
      {
        version: 'v2',
        productVersion: 'v2.0.0',
        status: 'approved',
        authorBotId: 'bot-atlas',
        note: '确定 SSG + ISR 方案，补充数据流图',
        createdAt: T0 - day * 1,
        content: `# 企业官网 v2 · 技术架构

需求见 [[prd-website-v2]]。

## 总体方案
采用 **SSG + ISR**（增量静态再生）：构建期预渲染，内容更新时按需再生，兼顾性能与实时性。

## 分层
- **表现层**：React 组件库（落地页模块化）
- **内容层**：Headless CMS，接口契约见 [[api-cms]]
- **交付层**：CDN 边缘缓存

## 关键决策
CMS 选型理由见 [[adr-cms-choice]]。

\`\`\`
用户 → CDN(边缘缓存) → SSG 页面
                          ↑ ISR 再生
                     Headless CMS ← 编辑同学
\`\`\`

## 性能预算
- JS 首包 < 120KB gzip
- 图片全量懒加载 + AVIF`,
      },
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'draft',
        authorBotId: 'bot-atlas',
        note: '架构初稿',
        createdAt: T0 - day * 2,
        content: `# 企业官网 v2 · 技术架构（初稿）

需求见 [[prd-website-v2]]。采用静态生成方案，接入 CMS。`,
      },
    ],
  },
  {
    slug: 'api-cms',
    title: '内容 CMS · 接口契约',
    type: 'api',
    productId: 'product-website',
    ownerBotId: 'bot-orion',
    requirementId: 'req-1',
    relations: [{ rel: 'implements', target: 'arch-website' }],
    versions: [
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'review',
        authorBotId: 'bot-orion',
        note: '定义内容模型与读取接口',
        createdAt: T0 - day * 1,
        content: `# 内容 CMS · 接口契约

服务于 [[arch-website]] 的内容层。

## 内容模型：Page
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| slug | string | 页面路径 |
| blocks | Block[] | 模块列表 |
| seo | SEO | 元信息 |

## 读取接口
\`\`\`http
GET /api/content/pages/:slug
200 → { slug, blocks, seo, updatedAt }
\`\`\`

## Webhook（触发 ISR 再生）
\`\`\`http
POST /webhooks/cms/published
body: { slug }
\`\`\`

需求背景见 [[prd-website-v2]]。`,
      },
    ],
  },
  {
    slug: 'design-landing',
    title: '落地页 · 视觉设计规范',
    type: 'design',
    productId: 'product-website',
    ownerBotId: 'bot-nova',
    requirementId: 'req-1',
    relations: [{ rel: 'implements', target: 'prd-website-v2' }],
    versions: [
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'draft',
        authorBotId: 'bot-nova',
        note: '设计 token 与栅格初稿',
        createdAt: T0 - day * 1,
        content: `# 落地页 · 视觉设计规范

对应需求 [[prd-website-v2]]。

## 设计 Token
- 主色 #4f46e5，强调色 #0891b2
- 圆角 12px，卡片阴影 sm
- 字体 Inter / 思源黑体

## 栅格
12 栏，最大宽度 1200px，移动端单列。`,
      },
    ],
  },
  {
    slug: 'adr-cms-choice',
    title: 'ADR-001 · CMS 选型',
    type: 'adr',
    productId: 'product-website',
    ownerBotId: 'bot-atlas',
    requirementId: 'req-1',
    relations: [{ rel: 'decides', target: 'arch-website' }],
    versions: [
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'approved',
        authorBotId: 'bot-atlas',
        note: '决策记录',
        createdAt: T0 - day * 2,
        content: `# ADR-001 · CMS 选型

**状态**：已采纳 · 服务架构 [[arch-website]]

## 背景
需要一个非技术同学可用、且能被静态站点消费的内容源。

## 选项
1. 自建 CMS — 成本高
2. **Headless CMS（采纳）** — 开箱即用，接口契约见 [[api-cms]]
3. 纯 Markdown 文件 — 编辑门槛高

## 决策
采用 Headless CMS，通过 Webhook 触发 ISR 再生。`,
      },
    ],
  },
  {
    slug: 'test-plan-website',
    title: '企业官网 v2 · 测试计划',
    type: 'test',
    productId: 'product-website',
    ownerBotId: 'bot-rigel',
    requirementId: 'req-1',
    relations: [{ rel: 'verifies', target: 'prd-website-v2' }],
    versions: [
      {
        version: 'v1',
        productVersion: 'v2.0.0',
        status: 'draft',
        authorBotId: 'bot-rigel',
        note: '测试范围初稿',
        createdAt: T0 - day * 1,
        content: `# 企业官网 v2 · 测试计划

覆盖需求 [[prd-website-v2]] 的验收标准。

## 范围
- 性能：Lighthouse CI，LCP < 2s
- 功能：CMS 编辑 → 前端更新 E2E
- 兼容：主流机型 + 浏览器矩阵

## 用例
| 编号 | 场景 | 预期 |
| --- | --- | --- |
| T-01 | 编辑首页 Hero 并发布 | 60s 内前端可见 |
| T-02 | 移动端首屏 | LCP < 2s |`,
      },
    ],
  },
  {
    slug: 'prd-bi-dashboard',
    title: '季度经营数据看板 · 产品需求',
    type: 'prd',
    productId: 'product-bi',
    ownerBotId: 'bot-lyra',
    requirementId: 'req-2',
    relations: [],
    versions: [
      {
        version: 'v1',
        productVersion: 'v1.0.0',
        status: 'draft',
        authorBotId: 'bot-lyra',
        note: '初稿',
        createdAt: T0 - day * 1,
        content: `# 季度经营数据看板 · 产品需求

## 目标
汇总销售、库存、客服数据，产出可交互 BI 看板，每周自动刷新。

## 数据源
三方系统对接，口径统一后入仓。

> 架构与接口待拆解，将补充关联文档。`,
      },
    ],
  },
]
