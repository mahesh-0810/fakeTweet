import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateUserId, seedDb, getDb } from './db.js'

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
