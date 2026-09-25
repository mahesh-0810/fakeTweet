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
// Point at a guaranteed-unreachable address by default so the suite is
// deterministic (sentiment always falls back to null) regardless of
// whether a real sentiment/index.js happens to be running locally.
// Individual tests may still override this for the duration of one test.
process.env.SENTIMENT_API_URL = process.env.SENTIMENT_API_URL || 'http://127.0.0.1:1/api/sentiment'

const { initDb } = await import('../db.js')
await initDb()
