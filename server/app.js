import express from 'express'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { getDb, generateUserId } from './db.js'
import { signToken, requireAuth, SESSION_COOKIE } from './middleware/auth.js'
import { fetchSentiment } from './sentiment.js'

const DEFAULT_TWEETS_LIMIT = 50
const MAX_TWEETS_LIMIT = 100

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function normalizeBoolColumn(value) {
  if (value === null || value === undefined) return null
  return value === 1 || value === true
}

export function createApp() {
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
  const app = express()

  app.use(express.json())
  app.use(cookieParser())
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'))
  }

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', CLIENT_ORIGIN)
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    res.header('Access-Control-Allow-Credentials', 'true')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many attempts. Please try again later.' },
  })

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected' })
  })

  app.post(
    '/api/auth/register',
    authLimiter,
    asyncHandler(async (req, res) => {
      const { username, password } = req.body ?? {}

      if (!username?.trim() || !password || password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required fields. Password must be at least 8 characters long.',
        })
      }

      const key = username.trim().toLowerCase()
      const db = getDb()

      const existing = await db.getAsync('SELECT id FROM users WHERE username = ?;', [key])
      if (existing) {
        return res.status(409).json({ success: false, error: 'This username is already taken.' })
      }

      const passwordHash = await bcrypt.hash(password, 10)
      await db.runAsync('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?);', [
        generateUserId(),
        key,
        passwordHash,
      ])

      res.status(201).json({ success: true, message: 'User registered successfully' })
    })
  )

  app.post(
    '/api/auth/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      const { username, password } = req.body ?? {}

      if (!username?.trim() || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required fields.',
        })
      }

      const key = username.trim().toLowerCase()
      const db = getDb()

      const user = await db.getAsync(
        'SELECT id, username, password_hash FROM users WHERE username = ?;',
        [key]
      )

      const valid = user && (await bcrypt.compare(password, user.password_hash))
      if (!valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password credentials.',
        })
      }

      const token = signToken(user)
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      res.json({ success: true, user: { id: user.id, username: user.username } })
    })
  )

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE)
    res.json({ success: true })
  })

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: req.user })
  })

  app.get(
    '/api/users/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const db = getDb()

      const profile = await db.getAsync('SELECT id, username, created_at FROM users WHERE id = ?;', [
        req.user.id,
      ])

      if (!profile) {
        return res.status(401).json({ success: false, error: 'Not authenticated.' })
      }

      res.json({ success: true, profile })
    })
  )

  app.put(
    '/api/users/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { username } = req.body ?? {}

      if (!username?.trim()) {
        return res.status(400).json({ success: false, error: 'Username is required.' })
      }

      const key = username.trim().toLowerCase()
      const db = getDb()

      const existing = await db.getAsync('SELECT id FROM users WHERE username = ? AND id != ?;', [
        key,
        req.user.id,
      ])
      if (existing) {
        return res.status(409).json({ success: false, error: 'This username is already taken.' })
      }

      await db.runAsync('UPDATE users SET username = ? WHERE id = ?;', [key, req.user.id])

      const token = signToken({ id: req.user.id, username: key })
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      res.json({ success: true, profile: { id: req.user.id, username: key } })
    })
  )

  app.put(
    '/api/users/password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body ?? {}

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password and new password are required fields.',
        })
      }

      const db = getDb()

      const user = await db.getAsync('SELECT password_hash FROM users WHERE id = ?;', [req.user.id])
      const valid = user && (await bcrypt.compare(currentPassword, user.password_hash))
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect.' })
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters long.',
        })
      }

      const passwordHash = await bcrypt.hash(newPassword, 10)
      await db.runAsync('UPDATE users SET password_hash = ? WHERE id = ?;', [
        passwordHash,
        req.user.id,
      ])

      res.json({ success: true })
    })
  )

  app.get(
    '/api/dashboard/summary',
    requireAuth,
    asyncHandler(async (req, res) => {
      const db = getDb()

      const stats = await db.getAsync(
        'SELECT COUNT(*) as total_tweets, COUNT(DISTINCT user_id) as total_authors FROM tweets;'
      )
      const breakdown = await db.allAsync(
        `SELECT users.username, COUNT(tweets.id) as tweet_count
         FROM tweets
         JOIN users ON tweets.user_id = users.id
         GROUP BY users.username
         ORDER BY tweet_count DESC;`
      )

      res.json({
        success: true,
        stats: { totalTweets: stats.total_tweets, totalAuthors: stats.total_authors },
        breakdown,
      })
    })
  )

  app.get(
    '/api/tweets',
    requireAuth,
    asyncHandler(async (req, res) => {
      const db = getDb()
      const { scope, search } = req.query

      const conditions = []
      const params = []

      if (scope === 'mine') {
        conditions.push('tweets.user_id = ?')
        params.push(req.user.id)
      }

      const term = typeof search === 'string' ? search.trim() : ''
      if (term) {
        conditions.push('tweets.content LIKE ?')
        params.push(`%${term}%`)
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rawLimit = Number.parseInt(req.query.limit, 10)
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_TWEETS_LIMIT) : DEFAULT_TWEETS_LIMIT

      const rawOffset = Number.parseInt(req.query.offset, 10)
      const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0

      // Fetch one extra row to know whether there's a next page without a second COUNT query.
      const rows = await db.allAsync(
        `SELECT tweets.id, tweets.content, tweets.created_at, tweets.sentiment, tweets.global, users.username
         FROM tweets
         JOIN users ON tweets.user_id = users.id
         ${whereClause}
         ORDER BY tweets.created_at DESC, tweets.id DESC
         LIMIT ? OFFSET ?;`,
        [...params, limit + 1, offset]
      )

      const tweets = rows
        .slice(0, limit)
        .map((row) => ({
          ...row,
          sentiment: normalizeBoolColumn(row.sentiment),
          global: normalizeBoolColumn(row.global),
        }))

      res.json({ success: true, tweets, hasMore: rows.length > limit })
    })
  )

  app.post(
    '/api/tweets',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { content } = req.body ?? {}
      const trimmed = typeof content === 'string' ? content.trim() : ''

      if (!trimmed || trimmed.length > 280) {
        return res.status(400).json({
          success: false,
          error: 'Tweet content is required and must be 280 characters or fewer.',
        })
      }

      const db = getDb()

      // Save first: sentiment/global default to NULL (unverified) until the
      // async check below resolves. The client never waits on the sentiment
      // service to see its own tweet.
      const id = await db.runInsertAsync(
        'INSERT INTO tweets (user_id, content) VALUES (?, ?);',
        [req.user.id, trimmed]
      )
      const row = await db.getAsync(
        'SELECT id, content, created_at, sentiment, global FROM tweets WHERE id = ?;',
        [id]
      )

      res.status(201).json({
        success: true,
        tweet: {
          ...row,
          sentiment: normalizeBoolColumn(row.sentiment),
          global: normalizeBoolColumn(row.global),
          username: req.user.username,
        },
      })

      // Fire-and-forget, after responding: resolve sentiment out-of-band and
      // persist it. `null` (service down/unreachable/timed out/malformed)
      // leaves both columns NULL for a later re-check — no write needed.
      // Negative-sentiment tweets are no longer deleted here; that's handled
      // by a separate, dedicated feature.
      fetchSentiment(trimmed)
        .then((sentiment) => {
          if (sentiment === null) return
          const value = sentiment ? 1 : 0
          return db.runAsync('UPDATE tweets SET sentiment = ?, global = ? WHERE id = ?;', [
            value,
            value,
            id,
          ])
        })
        .catch((err) => console.error(`Failed to persist sentiment for tweet ${id}:`, err))
    })
  )

  app.use((err, req, res, _next) => {
    console.error(err)
    const status = err.status || err.statusCode || 500
    if (status >= 500) {
      return res.status(status).json({ success: false, error: 'Something went wrong. Please try again.' })
    }
    res.status(status).json({ success: false, error: err.message || 'Bad request.' })
  })

  return app
}
