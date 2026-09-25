const DEFAULT_SENTIMENT_API_URL = 'http://localhost:3001/api/sentiment'
const DEFAULT_TIMEOUT_MS = 3000

// Never throws. Returns true/false on a well-formed response, null on any
// failure: network error, non-2xx status, malformed JSON body, missing/
// non-boolean `sentiment` field, or timeout.
export async function fetchSentiment(content, opts = {}) {
  const url = opts.url ?? process.env.SENTIMENT_API_URL ?? DEFAULT_SENTIMENT_API_URL
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet: content }),
      signal: controller.signal,
    })

    if (!res.ok) return null

    const body = await res.json()
    return typeof body?.sentiment === 'boolean' ? body.sentiment : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
