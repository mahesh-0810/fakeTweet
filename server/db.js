import sqlite3Pkg from 'sqlite3'
import bcrypt from 'bcryptjs'
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
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`

export async function initDb() {
  const db = getDb()
  await db.runAsync('PRAGMA foreign_keys = ON;')
  await db.runAsync(CREATE_USERS_TABLE)
  await db.runAsync(CREATE_TWEETS_TABLE)
}

export async function seedDb() {
  const db = getDb()

  const row = await db.getAsync('SELECT COUNT(*) AS count FROM users;')
  if (row.count > 0) return

  const id = generateUserId()
  const username = 'mahesh'.toLowerCase()
  const passwordHash = await bcrypt.hash('mahesh', 10)

  await db.runAsync(
    'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?);',
    [id, username, passwordHash]
  )
}
