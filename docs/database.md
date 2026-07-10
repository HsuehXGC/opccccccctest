# OPC · 数据库设计

## 1. 现状

M1 无数据库：全部领域数据在前端 `frontend/src/store/useStore.ts` 的内存 Zustand store 中，
由 `frontend/src/mock/` 的种子数据初始化，刷新即重置。本文给出 **M3 目标持久化模型**（PostgreSQL）。

## 2. 实体关系（概览）

```
orgs 1─* accounts
orgs 1─* projects 1─* products 1─* requirements
                              products 1─* wiki_docs 1─* doc_versions
                              products 1─* tasks
requirements 1─* tasks           tasks *─* tasks (依赖)
wiki_docs *─* wiki_docs (类型化关系)
orgs 1─* bots
accounts 1─* machines 1─* executors
tasks 1─* jobs *─1 executors
```

作用域锚点：一切经 `product.project_id → project.org_id` 归属组织；
`bots / machines` 直接挂 `org_id / account_id`。

## 3. 表设计（DDL 摘要，PostgreSQL）

```sql
-- 组织与账户 ---------------------------------------------------
create table orgs (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table accounts (
  id          text primary key,
  org_id      text not null references orgs(id),
  name        text not null,
  email       citext not null unique,
  kind        text not null check (kind in ('root','member')),
  member_role text,                       -- 编辑/只读/管理员
  avatar_seed text not null,
  created_at  timestamptz not null default now()
);

-- 项目 / 产品 --------------------------------------------------
create table projects (
  id          text primary key,
  org_id      text not null references orgs(id),
  name        text not null,
  description text default '',
  created_at  timestamptz not null default now()
);

create table products (
  id              text primary key,
  project_id      text not null references projects(id),
  name            text not null,
  description     text default '',
  current_version text not null default 'v1.0.0'
);

-- 需求 ---------------------------------------------------------
create table requirements (
  id          text primary key,
  product_id  text references products(id),
  title       text not null,
  description text default '',
  content     text default '',            -- Markdown 正文
  priority    text not null check (priority in ('low','medium','high','urgent')),
  status      text not null check (status in ('draft','planning','active','done')),
  created_at  timestamptz not null default now()
);

-- 产品文档 Wiki ------------------------------------------------
create table wiki_docs (
  id              text primary key,
  product_id      text not null references products(id),
  slug            text not null,          -- 产品内唯一，用于 [[slug]] 互链
  title           text not null,
  type            text not null,          -- vision/prd/story/arch/api/data/design/adr/test/release
  owner_bot_id    text references bots(id),
  requirement_id  text references requirements(id),
  created_at      timestamptz not null default now(),
  unique (product_id, slug)
);

create table doc_versions (               -- 混合版本：每篇独立迭代
  id              bigserial primary key,
  doc_id          text not null references wiki_docs(id) on delete cascade,
  version         text not null,          -- v1/v2/v3…
  product_version text not null,          -- 该版本所服务的产品版本
  content         text not null,
  status          text not null check (status in ('draft','review','approved','archived')),
  author_bot_id   text references bots(id),
  note            text default '',
  created_at      timestamptz not null default now(),
  unique (doc_id, version)
);

create table doc_relations (              -- 类型化关系（有向）
  src_doc_id text not null references wiki_docs(id) on delete cascade,
  rel        text not null check (rel in ('derives','implements','verifies','decides','references')),
  target_doc_id text not null references wiki_docs(id) on delete cascade,
  primary key (src_doc_id, rel, target_doc_id)
);

-- 任务 ---------------------------------------------------------
create table tasks (
  id               text primary key,
  product_id       text references products(id),
  requirement_id   text references requirements(id),
  bot_id           text references bots(id),
  title            text not null,
  description      text default '',
  kind             text not null check (kind in ('doc','work')),
  status           text not null check (status in ('backlog','in_progress','review','done')),
  priority         text not null,
  brief            text default '',        -- 执行简报 = claude -p 输入
  target_doc_id    text references wiki_docs(id),  -- 文档任务的目标文档
  output           text,                   -- 执行成果 / 起草的文档正文
  progress         int not null default 0,
  created_at       timestamptz not null default now()
);

create table task_dependencies (           -- A 阻塞 B
  task_id            text not null references tasks(id) on delete cascade,
  depends_on_task_id text not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id)
);

create table task_logs (
  id         bigserial primary key,
  task_id    text not null references tasks(id) on delete cascade,
  line       text not null,
  created_at timestamptz not null default now()
);

-- 虚拟人力（账户组级共享）--------------------------------------
create table bots (
  id              text primary key,
  org_id          text not null references orgs(id),
  name            text not null,
  role            text not null,
  model           text not null,
  status          text not null check (status in ('idle','working','paused','offline')),
  current_task_id text references tasks(id),
  skills          jsonb not null default '[]',
  completed       int not null default 0,
  avatar_seed     text not null,
  executor_id     text references executors(id)  -- M2：机器人绑定到执行器
);

-- 本地算力 -----------------------------------------------------
create table machines (
  id         text primary key,
  account_id text not null references accounts(id),
  name       text not null,
  os         text not null,
  status     text not null check (status in ('online','offline')),
  last_seen  timestamptz
);

create table executors (
  id         text primary key,
  machine_id text not null references machines(id) on delete cascade,
  kind       text not null check (kind in ('claude','codex')),
  label      text not null,
  status     text not null check (status in ('idle','busy','offline'))
);

-- 接入凭证与执行记录 ------------------------------------------
create table enroll_tokens (
  token      text primary key,
  account_id text not null references accounts(id),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table jobs (                        -- 一次派单的执行记录
  id          text primary key,
  task_id     text references tasks(id),
  executor_id text references executors(id),
  machine_id  text references machines(id),
  status      text not null check (status in ('dispatched','running','done','error','canceled')),
  result      text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
```

## 4. 索引建议
```sql
create index on products (project_id);
create index on requirements (product_id);
create index on wiki_docs (product_id);
create index on doc_versions (doc_id, created_at desc);
create index on tasks (product_id, status);
create index on machines (account_id);
create index on jobs (task_id);
```

## 5. 多租户隔离

- 所有内容查询按 `project_id`（经产品）与 `org_id` 作用域过滤
- 建议启用**行级安全（RLS）**：以 `org_id` 为策略键，应用连接时设置 `app.current_org`
- `bots / machines / executors` 按 `org_id / account_id` 隔离

## 6. 凭证与密钥

- `enroll_tokens` 一次性、短时效，用后置 `used_at`
- 机器长期 `agentToken`、以及云端登录 claude/codex 所需的敏感凭证：**存 KMS / Secrets Manager**，
  数据库仅存引用（不落明文）

## 7. 从 mock 迁移

M1 的 `frontend/src/mock/*` 与 `types.ts` 是本模型的事实来源；迁移时字段一一对应，
注意：前端把 `doc_relations` 的 `target` 与 `tasks.target_doc_slug` 用 slug 表达，
入库时解析为 `wiki_docs.id` 外键。
