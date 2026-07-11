-- OPC 云端数据 schema（全量上云）
-- 用文本主键，保留前端现有 id/slug，便于把浏览器数据 1:1 导入。

CREATE TABLE IF NOT EXISTS orgs (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  name          text NOT NULL,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'member',
  member_role   text,
  avatar_seed   text,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

CREATE TABLE IF NOT EXISTS products (
  id              text PRIMARY KEY,
  project_id      text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  current_version text NOT NULL DEFAULT 'v1.0.0',
  created_at      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_project ON products(project_id);

CREATE TABLE IF NOT EXISTS bots (
  id              text PRIMARY KEY,
  org_id          text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL,
  avatar_seed     text,
  status          text NOT NULL DEFAULT 'idle',
  charter         jsonb,
  current_task_id text,
  completed       integer NOT NULL DEFAULT 0,
  created_at      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bots_org ON bots(org_id);

CREATE TABLE IF NOT EXISTS requirements (
  id          text PRIMARY KEY,
  product_id  text,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',
  priority    text NOT NULL DEFAULT 'medium',
  status      text NOT NULL DEFAULT 'draft',
  created_at  bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_req_product ON requirements(product_id);

CREATE TABLE IF NOT EXISTS docs (
  slug           text PRIMARY KEY,
  product_id     text,
  title          text NOT NULL,
  type           text NOT NULL DEFAULT 'prd',
  owner_bot_id   text,
  requirement_id text,
  relations      jsonb NOT NULL DEFAULT '[]',
  created_at     bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_docs_product ON docs(product_id);

CREATE TABLE IF NOT EXISTS doc_versions (
  id              text PRIMARY KEY,
  doc_slug        text NOT NULL,
  idx             integer NOT NULL DEFAULT 0,
  content         text NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',
  author_bot_id   text,
  product_version text,
  status          text NOT NULL DEFAULT 'draft',
  created_at      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_docver_slug ON doc_versions(doc_slug);

CREATE TABLE IF NOT EXISTS tasks (
  id              text PRIMARY KEY,
  product_id      text,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  kind            text NOT NULL DEFAULT 'work',
  status          text NOT NULL DEFAULT 'backlog',
  priority        text NOT NULL DEFAULT 'medium',
  requirement_id  text,
  bot_id          text,
  brief           text NOT NULL DEFAULT '',
  target_doc_slug text,
  output          text,
  progress        integer NOT NULL DEFAULT 0,
  depends_on      jsonb NOT NULL DEFAULT '[]',
  log             jsonb NOT NULL DEFAULT '[]',
  created_at      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id);

CREATE TABLE IF NOT EXISTS meetings (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL,
  project_id          text,
  product_id          text,
  title               text NOT NULL,
  agenda              text NOT NULL DEFAULT '',
  kind                text NOT NULL DEFAULT 'kickoff',
  status              text NOT NULL DEFAULT 'draft',
  participant_bot_ids jsonb NOT NULL DEFAULT '[]',
  refs                text NOT NULL DEFAULT '',
  full_doc_slugs      jsonb NOT NULL DEFAULT '[]',
  parallel            boolean NOT NULL DEFAULT false,
  rounds              integer NOT NULL DEFAULT 1,
  output              text NOT NULL DEFAULT '',
  created_at          bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meetings_org ON meetings(org_id);

CREATE TABLE IF NOT EXISTS meeting_messages (
  id           text PRIMARY KEY,
  meeting_id   text NOT NULL,
  speaker_type text NOT NULL,
  speaker_id   text,
  speaker_name text,
  speaker_role text,
  avatar_seed  text,
  content      text NOT NULL DEFAULT '',
  round        integer NOT NULL DEFAULT 1,
  created_at   bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mtgmsg_meeting ON meeting_messages(meeting_id);

-- 云端调度：任务/会议发言/文档撰写都以 job 落库，后端 worker 常驻执行，关页面不中断
CREATE TABLE IF NOT EXISTS jobs (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  kind        text NOT NULL,            -- task | meeting_turn | doc_author | adhoc
  ref_type    text,                     -- task | meeting | doc
  ref_id      text,                     -- 关联的 taskId / meetingId 等
  title       text NOT NULL DEFAULT '',
  executor_id text,
  prompt      text NOT NULL,
  mode        text,                     -- plan | null
  status      text NOT NULL DEFAULT 'queued', -- queued | running | done | error | canceled
  output      text NOT NULL DEFAULT '',
  error       text,
  chunks      integer NOT NULL DEFAULT 0,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  bigint NOT NULL DEFAULT 0,
  started_at  bigint,
  finished_at bigint
);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- 迁移期混合存储：每张领域表存前端完整对象(raw)，保证读回 1:1；
-- 后端只对少数字段（如 task 状态/产出）做权威写，读取时用列覆盖 raw。
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE products     ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE docs         ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE bots         ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE meetings     ADD COLUMN IF NOT EXISTS raw jsonb;

-- 下层表补 org_id，便于按账户组一次性读取
ALTER TABLE products     ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE docs         ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS org_id text;
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
CREATE INDEX IF NOT EXISTS idx_req_org ON requirements(org_id);
CREATE INDEX IF NOT EXISTS idx_docs_org ON docs(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);

-- 会议编排负载（含各角色 prompt 片段），进程重启后据此恢复运行中的会议
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS run_payload jsonb;

-- job 附带元数据（如文档撰写 job 的 doc 元信息），供前端据产出重建实体
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS meta jsonb;
