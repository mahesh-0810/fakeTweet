import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createApp } from './app.js'

function randomUsername() {
  return `user_${Math.random().toString(36).slice(2, 10)}`
}

async function startTestServer() {
  const app = createApp()
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function registerAndLogin(baseUrl, username, password) {
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return loginRes.headers.get('set-cookie')
}

test('GET /api/health returns ok', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const res = await fetch(`${baseUrl}/api/health`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'ok')
})

test('register rejects a short password and a duplicate username', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const username = randomUsername()

  const shortPasswordRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'short' }),
  })
  assert.equal(shortPasswordRes.status, 400)

  const firstRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-fine-password' }),
  })
  assert.equal(firstRes.status, 201)

  const dupeRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-fine-password' }),
  })
  assert.equal(dupeRes.status, 409)
})

test('login rejects the wrong password and succeeds with the right one', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const username = randomUsername()
  const password = 'a-fine-password'
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const badRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'wrong-password' }),
  })
  assert.equal(badRes.status, 401)

  const goodRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  assert.equal(goodRes.status, 200)
  assert.ok(goodRes.headers.get('set-cookie'), 'login should set a session cookie')
})

test('tweets require auth to read or post, and round-trip correctly', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const unauthedRes = await fetch(`${baseUrl}/api/tweets`)
  assert.equal(unauthedRes.status, 401)

  const cookie = await registerAndLogin(baseUrl, randomUsername(), 'a-fine-password')

  const postRes = await fetch(`${baseUrl}/api/tweets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: 'hello from the test suite' }),
  })
  assert.equal(postRes.status, 201)
  const postBody = await postRes.json()
  assert.ok(
    postBody.tweet.sentiment === true || postBody.tweet.sentiment === false || postBody.tweet.sentiment === null,
    'sentiment must be true, false, or null — never 0/1/undefined'
  )

  const feedRes = await fetch(`${baseUrl}/api/tweets?scope=mine`, { headers: { Cookie: cookie } })
  const feed = await feedRes.json()
  assert.equal(feed.tweets.length, 1)
  assert.equal(feed.tweets[0].content, 'hello from the test suite')
  assert.ok(
    feed.tweets[0].sentiment === true || feed.tweets[0].sentiment === false || feed.tweets[0].sentiment === null,
    'sentiment must be true, false, or null — never 0/1/undefined'
  )
})

test('GET /api/tweets paginates via limit/offset and reports hasMore', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const cookie = await registerAndLogin(baseUrl, randomUsername(), 'a-fine-password')

  for (let i = 0; i < 3; i++) {
    await fetch(`${baseUrl}/api/tweets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: `tweet number ${i}` }),
    })
  }

  const page1 = await (
    await fetch(`${baseUrl}/api/tweets?scope=mine&limit=2`, { headers: { Cookie: cookie } })
  ).json()
  assert.equal(page1.tweets.length, 2)
  assert.equal(page1.hasMore, true)

  const page2 = await (
    await fetch(`${baseUrl}/api/tweets?scope=mine&limit=2&offset=2`, { headers: { Cookie: cookie } })
  ).json()
  assert.equal(page2.tweets.length, 1)
  assert.equal(page2.hasMore, false)
})

test('the auth rate limiter blocks after repeated attempts', async (t) => {
  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  let lastStatus
  for (let i = 0; i < 11; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'wrong-password' }),
    })
    lastStatus = res.status
  }
  assert.equal(lastStatus, 429)
})

test('a negative-sentiment tweet is inserted then deleted, and the client sees a 422 with no trace', async (t) => {
  const sentimentServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tweet: '', sentiment: false }))
  })
  await new Promise((resolve) => sentimentServer.listen(0, resolve))
  const { port } = sentimentServer.address()

  const originalSentimentUrl = process.env.SENTIMENT_API_URL
  process.env.SENTIMENT_API_URL = `http://127.0.0.1:${port}/api/sentiment`
  t.after(() => {
    sentimentServer.close()
    if (originalSentimentUrl === undefined) delete process.env.SENTIMENT_API_URL
    else process.env.SENTIMENT_API_URL = originalSentimentUrl
  })

  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const cookie = await registerAndLogin(baseUrl, randomUsername(), 'a-fine-password')

  const postRes = await fetch(`${baseUrl}/api/tweets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: 'this is a negative tweet' }),
  })
  assert.equal(postRes.status, 422)
  const postBody = await postRes.json()
  assert.equal(postBody.success, false)
  assert.ok(typeof postBody.error === 'string' && postBody.error.length > 0)

  const feedRes = await fetch(`${baseUrl}/api/tweets?scope=mine`, { headers: { Cookie: cookie } })
  const feed = await feedRes.json()
  assert.equal(feed.tweets.length, 0)
})

test('an unverified-sentiment tweet (service unreachable) still posts, kept with sentiment null for later resolution', async (t) => {
  const originalSentimentUrl = process.env.SENTIMENT_API_URL
  // Port 1 refuses connections immediately — fetchSentiment resolves to null.
  process.env.SENTIMENT_API_URL = 'http://127.0.0.1:1/api/sentiment'
  t.after(() => {
    if (originalSentimentUrl === undefined) delete process.env.SENTIMENT_API_URL
    else process.env.SENTIMENT_API_URL = originalSentimentUrl
  })

  const { server, baseUrl } = await startTestServer()
  t.after(() => server.close())

  const cookie = await registerAndLogin(baseUrl, randomUsername(), 'a-fine-password')

  const postRes = await fetch(`${baseUrl}/api/tweets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: 'this tweet has unverifiable sentiment' }),
  })
  assert.equal(postRes.status, 201)
  const postBody = await postRes.json()
  assert.equal(postBody.success, true)
  assert.equal(postBody.tweet.sentiment, null)

  const feedRes = await fetch(`${baseUrl}/api/tweets?scope=mine`, { headers: { Cookie: cookie } })
  const feed = await feedRes.json()
  assert.equal(feed.tweets.length, 1)
  assert.equal(feed.tweets[0].sentiment, null)
})
