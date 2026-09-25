import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchSentiment } from './sentiment.js'

async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, resolve))
  const { port } = server.address()
  return { server, url: `http://127.0.0.1:${port}/api/sentiment` }
}

test('fetchSentiment returns true on a well-formed 200 response', async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tweet: 'hello', sentiment: true }))
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url }), true)
})

test('fetchSentiment returns false on a well-formed 200 response', async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tweet: 'hello', sentiment: false }))
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url }), false)
})

test('fetchSentiment returns null on a non-200 status', async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'boom' }))
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url }), null)
})

test('fetchSentiment returns null on a malformed JSON body', async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('not json')
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url }), null)
})

test('fetchSentiment returns null when `sentiment` is missing or non-boolean', async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tweet: 'hello', sentiment: 'yes' }))
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url }), null)
})

test('fetchSentiment returns null when the response is slower than the timeout', async (t) => {
  const { server, url } = await startServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tweet: 'hello', sentiment: true }))
    }, 200)
  })
  t.after(() => server.close())

  assert.equal(await fetchSentiment('hello', { url, timeoutMs: 50 }), null)
})

test('fetchSentiment returns null when the service is unreachable', async () => {
  const { server } = await startServer((req, res) => res.end())
  const closedPort = server.address().port
  await new Promise((resolve) => server.close(resolve))

  assert.equal(
    await fetchSentiment('hello', { url: `http://127.0.0.1:${closedPort}/api/sentiment`, timeoutMs: 500 }),
    null
  )
})
