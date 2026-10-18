// Shared helpers for the Vercel serverless functions (Neon Postgres).
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
let ready;

function init() {
  ready = ready || sql.transaction([
    sql`CREATE SEQUENCE IF NOT EXISTS records_seq`,
    sql`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, col TEXT NOT NULL, data JSONB NOT NULL,
      updated_at BIGINT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      seq BIGINT NOT NULL DEFAULT nextval('records_seq'))`,
    sql`CREATE INDEX IF NOT EXISTS records_seq_idx ON records(seq)`
  ]).catch(e => { ready = null; throw e; });
  return ready;
}

module.exports = { sql, init, COLS: new Set(['businesses', 'shops', 'rentPayments', 'roznamcha']) };
