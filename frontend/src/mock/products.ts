import type { Product } from '../types'

// 产品挂在项目之下；项目 alpha（云舟数字）含官网+大促，bravo（数聚科技）含数据看板
export const seedProducts: Product[] = [
  {
    id: 'product-website',
    projectId: 'project-alpha',
    name: '企业官网 v2',
    description: '重构落地页、接入 CMS、移动端优化的官网产品线。',
    currentVersion: 'v2.0.0',
  },
  {
    id: 'product-promo',
    projectId: 'project-alpha',
    name: '大促营销',
    description: '大促主题的文案与营销物料产品线。',
    currentVersion: 'v1.0.0',
  },
  {
    id: 'product-bi',
    projectId: 'project-bravo',
    name: '经营数据看板',
    description: '汇总销售/库存/客服的可交互 BI 看板。',
    currentVersion: 'v1.0.0',
  },
]
