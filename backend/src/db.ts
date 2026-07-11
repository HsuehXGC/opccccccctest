import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

// ── PostgreSQL 连接池 ─────────────────────────────────────────
// 连接串从环境变量 DATABASE_URL 注入（写在 .env）。全量上云的持久层。
const { Pool } = pg

const url = process.env.DATABASE_URL
export const dbEnabled = !!url

export const pool = url ? new Pool({ connectionString: url, max: 10 }) : (null as unknown as pg.Pool)

/** 查询封装：q('SELECT ...', [args]) → rows */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}

/** 取单行（无则 null） */
export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}

/** 建表（幂等，启动时跑一次） */
export async function migrate(): Promise<void> {
  if (!dbEnabled) return
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8')
  await pool.query(sql)
  console.log('✓ DB schema 就绪 (PostgreSQL)')
}
