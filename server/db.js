import sqlite3Pkg from 'sqlite3'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const sqlite3 = sqlite3Pkg.verbose()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'chirp.db')

let dbInstance = null

export function getDb() {
  if (dbInstance) return dbInstance

  const conn = new sqlite3.Database(DB_PATH)
  conn.runAsync = promisify(conn.run.bind(conn))
  conn.getAsync = promisify(conn.get.bind(conn))
  conn.allAsync = promisify(conn.all.bind(conn))
  conn.runInsertAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      conn.run(sql, params, function (err) {
        if (err) reject(err)
        else resolve(this.lastID)
      })
    })

  dbInstance = conn
  return dbInstance
}

export function generateUserId() {
  return crypto.randomBytes(8).toString('hex')
}

const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

const CREATE_TWEETS_TABLE = `
  CREATE TABLE IF NOT EXISTS tweets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) <= 280),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sentiment INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`

function tableInfo(conn, table) {
  return new Promise((resolve, reject) => {
    conn.all(`PRAGMA table_info(${table});`, [], (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

function run(conn, sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}

// Idempotent: safe to call on every server start. Works against any
// sqlite3.Database connection (not just the getDb() singleton) so it's
// testable against a disposable file — CREATE TABLE IF NOT EXISTS above
// only covers brand-new databases, not chirp.db's pre-existing tweets table.
export async function ensureSentimentColumn(conn) {
  const columns = await tableInfo(conn, 'tweets')
  const hasSentiment = columns.some((col) => col.name === 'sentiment')
  if (!hasSentiment) {
    await run(conn, 'ALTER TABLE tweets ADD COLUMN sentiment INTEGER;')
  }
}

// Idempotent: covers pre-existing databases that still have the now-removed
// `global` column (it was redundant with `sentiment = 1`).
export async function dropGlobalColumn(conn) {
  const columns = await tableInfo(conn, 'tweets')
  const hasGlobal = columns.some((col) => col.name === 'global')
  if (hasGlobal) {
    await run(conn, 'ALTER TABLE tweets DROP COLUMN global;')
  }
}

export async function initDb() {
  const db = getDb()
  await db.runAsync('PRAGMA foreign_keys = ON;')
  await db.runAsync(CREATE_USERS_TABLE)
  await db.runAsync(CREATE_TWEETS_TABLE)
  await ensureSentimentColumn(db)
  await dropGlobalColumn(db)
}
