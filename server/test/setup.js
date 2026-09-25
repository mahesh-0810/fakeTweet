import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, 'test.db')

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(dbPath + suffix, { force: true })
}

process.env.DB_PATH = dbPath
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production'
process.env.CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
process.env.NODE_ENV = 'test'

const { initDb } = await import('../db.js')
await initDb()
