import { test } from 'node:test'
import assert from 'node:assert/strict'
import sqlite3Pkg from 'sqlite3'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateUserId, seedDb, getDb, ensureSentimentColumn } from './db.js'

test('generateUserId returns unique 16-character hex strings', () => {
  const a = generateUserId()
  const b = generateUserId()
  assert.match(a, /^[0-9a-f]{16}$/)
  assert.notEqual(a, b)
})

test('seedDb is idempotent — running it twice does not duplicate the demo user', async () => {
  await seedDb()
  await seedDb()

  const db = getDb()
  const row = await db.getAsync('SELECT COUNT(*) as count FROM users WHERE username = ?;', ['mahesh'])
  assert.equal(row.count, 1)
})

test('ensureSentimentColumn adds sentiment to a pre-existing tweets table without touching data', async (t) => {
  const dbPath = path.join(tmpdir(), `sentiment-migration-${Date.now()}-${process.pid}.db`)
  const conn = new sqlite3Pkg.Database(dbPath)
  t.after(() => {
    conn.close()
    rmSync(dbPath, { force: true })
  })

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      conn.run(sql, params, (err) => (err ? reject(err) : resolve()))
    })
  }
  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
    })
  }

  // Old-style table, predating the sentiment column.
  await run(`
    CREATE TABLE tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  await run('INSERT INTO tweets (user_id, content) VALUES (?, ?);', ['u1', 'pre-existing tweet'])

  await ensureSentimentColumn(conn)
  await ensureSentimentColumn(conn) // idempotent — must not throw on a second run

  const columns = await all('PRAGMA table_info(tweets);')
  assert.ok(columns.some((col) => col.name === 'sentiment'))

  const rows = await all('SELECT content, sentiment FROM tweets;')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, 'pre-existing tweet')
  assert.equal(rows[0].sentiment, null)
})
