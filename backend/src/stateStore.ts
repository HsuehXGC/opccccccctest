import { q, one } from './db.ts'

// ── 领域数据：导入（浏览器 → PG）+ 全量读取（PG → 前端） ─────────────
// 迁移期混合存储：raw jsonb 存前端完整对象保证 1:1；tasks 的状态/产出等由后端权威写，
// 读取时用列覆盖 raw。

type Any = Record<string, any>

const arr = (x: unknown): Any[] => (Array.isArray(x) ? (x as Any[]) : [])

/** 把一份前端 store 快照导入到某账户组（幂等 upsert） */
export async function importSnapshot(orgId: string, snap: Any): Promise<{ counts: Record<string, number> }> {
  const projects = arr(snap.projects).filter((p) => p.orgId === orgId)
  const projectIds = new Set(projects.map((p) => p.id))
  const products = arr(snap.products).filter((p) => projectIds.has(p.projectId))
  const productIds = new Set(products.map((p) => p.id))
  const requirements = arr(snap.requirements).filter((r) => productIds.has(r.productId))
  const docs = arr(snap.docs).filter((d) => productIds.has(d.productId))
  const tasks = arr(snap.tasks).filter((t) => productIds.has(t.productId))
  const bots = arr(snap.bots).filter((b) => b.orgId === orgId)
  const meetings = arr(snap.meetings).filter((m) => m.orgId === orgId)

  const J = (v: unknown) => JSON.stringify(v ?? null)

  for (const p of projects) {
    // workspace 后端权威（粘滞）：仅当传入快照带非空 repoPath（浏览器刚 provision/编辑工作区）才采用它，
    // 否则保留 PG 已有 workspace——防止陈旧标签页 auto-sync 用无 workspace 的旧快照把 repo 配置冲掉（会瘫痪自驾）。
    await q(
      `INSERT INTO projects (id, org_id, name, description, created_at, raw) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         raw = CASE
           WHEN COALESCE(excluded.raw -> 'workspace' ->> 'repoPath', '') <> '' THEN excluded.raw
           ELSE jsonb_set(excluded.raw, '{workspace}', COALESCE(projects.raw -> 'workspace', 'null'::jsonb), true)
         END`,
      [p.id, orgId, p.name ?? '', p.description ?? '', p.createdAt ?? 0, J(p)],
    )
  }
  for (const p of products) {
    await q(
      `INSERT INTO products (id, project_id, org_id, name, description, current_version, raw) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET project_id=$2, org_id=$3, name=$4, description=$5, current_version=$6, raw=$7`,
      [p.id, p.projectId, orgId, p.name ?? '', p.description ?? '', p.currentVersion ?? 'v1.0.0', J(p)],
    )
  }
  for (const r of requirements) {
    await q(
      `INSERT INTO requirements (id, product_id, org_id, title, description, content, priority, status, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET product_id=$2, org_id=$3, title=$4, description=$5, content=$6, priority=$7, status=$8, raw=$10`,
      [r.id, r.productId, orgId, r.title ?? '', r.description ?? '', r.content ?? '', r.priority ?? 'medium', r.status ?? 'draft', r.createdAt ?? 0, J(r)],
    )
  }
  for (const d of docs) {
    await q(
      `INSERT INTO docs (slug, product_id, org_id, title, type, owner_bot_id, requirement_id, relations, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (slug) DO UPDATE SET product_id=$2, org_id=$3, title=$4, type=$5, owner_bot_id=$6, requirement_id=$7, relations=$8, raw=$10`,
      [d.slug, d.productId, orgId, d.title ?? '', d.type ?? 'prd', d.ownerBotId ?? null, d.requirementId ?? null, J(d.relations ?? []), d.createdAt ?? 0, J(d)],
    )
  }
  for (const t of tasks) {
    await q(
      `INSERT INTO tasks (id, product_id, org_id, title, description, kind, status, priority, requirement_id, bot_id, brief, target_doc_slug, output, progress, depends_on, log, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET product_id=$2, org_id=$3, title=$4, description=$5, kind=$6, status=$7, priority=$8, requirement_id=$9, bot_id=$10, brief=$11, target_doc_slug=$12, output=$13, progress=$14, depends_on=$15, log=$16, raw=$18`,
      [t.id, t.productId, orgId, t.title ?? '', t.description ?? '', t.kind ?? 'work', t.status ?? 'backlog', t.priority ?? 'medium', t.requirementId ?? null, t.botId ?? null, t.brief ?? '', t.targetDocSlug ?? null, t.output ?? null, t.progress ?? 0, J(t.dependsOn ?? []), J(t.log ?? []), t.createdAt ?? 0, J(t)],
    )
  }
  for (const b of bots) {
    await q(
      `INSERT INTO bots (id, org_id, name, role, avatar_seed, status, charter, current_task_id, completed, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET org_id=$2, name=$3, role=$4, avatar_seed=$5, status=$6, charter=$7, current_task_id=$8, completed=$9, raw=$11`,
      [b.id, orgId, b.name ?? '', b.role ?? '', b.avatarSeed ?? null, b.status ?? 'idle', J(b.charter ?? null), b.currentTaskId ?? null, b.completed ?? 0, b.createdAt ?? 0, J(b)],
    )
  }
  for (const m of meetings) {
    await q(
      `INSERT INTO meetings (id, org_id, project_id, product_id, title, agenda, kind, status, participant_bot_ids, refs, full_doc_slugs, parallel, rounds, output, created_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET project_id=$3, product_id=$4, title=$5, agenda=$6, kind=$7, status=$8, participant_bot_ids=$9, refs=$10, full_doc_slugs=$11, parallel=$12, rounds=$13, output=$14, raw=$16
       WHERE meetings.status <> 'running'`,
      [m.id, orgId, m.projectId ?? null, m.productId ?? null, m.title ?? '', m.agenda ?? '', m.kind ?? 'kickoff', m.status ?? 'draft', J(m.participantBotIds ?? []), m.references ?? '', J(m.fullDocSlugs ?? []), !!m.parallel, m.rounds ?? 1, m.output ?? '', m.createdAt ?? 0, J(m)],
    )
  }

  return {
    counts: {
      projects: projects.length,
      products: products.length,
      requirements: requirements.length,
      docs: docs.length,
      tasks: tasks.length,
      bots: bots.length,
      meetings: meetings.length,
    },
  }
}

/** 读取某账户组的全量领域数据，返回前端 store 形状 */
export async function getOrgState(orgId: string): Promise<Any> {
  const rawsOf = async (sql: string) => (await q<{ raw: Any }>(sql, [orgId])).map((r) => r.raw).filter(Boolean)

  const projects = await rawsOf(`SELECT raw FROM projects WHERE org_id=$1`)
  const products = await rawsOf(`SELECT raw FROM products WHERE org_id=$1`)
  const requirements = await rawsOf(`SELECT raw FROM requirements WHERE org_id=$1`)
  const docs = await rawsOf(`SELECT raw FROM docs WHERE org_id=$1`)
  const bots = await rawsOf(`SELECT raw FROM bots WHERE org_id=$1`)
  const meetings = await rawsOf(`SELECT raw FROM meetings WHERE org_id=$1`)

  // tasks：raw 打底，用后端权威列覆盖（调度器会改 status/output/progress/log/bot_id）
  const taskRows = await q<Any>(
    `SELECT raw, status, output, progress, log, bot_id FROM tasks WHERE org_id=$1`,
    [orgId],
  )
  const tasks = taskRows
    .filter((r) => r.raw)
    .map((r) => ({ ...r.raw, status: r.status, output: r.output, progress: r.progress, log: r.log, botId: r.bot_id }))

  return { projects, products, requirements, docs, bots, meetings, tasks }
}

/** 账户组在 PG 里是否已有数据（用于前端判断要不要首次同步） */
export async function orgHasData(orgId: string): Promise<boolean> {
  const row = await one<{ n: string }>(
    `SELECT (SELECT count(*) FROM projects WHERE org_id=$1) + (SELECT count(*) FROM tasks WHERE org_id=$1) AS n`,
    [orgId],
  )
  return !!row && Number(row.n) > 0
}
