/**
 * Deterministic OpenAI-compatible stub for the A5 cache probe (criteria v2, stub route).
 *
 * It measures the plugin's warm/cold session logic only. Replies are scripted and start with
 * `STUB:`, the model id is `cache-stub/cache-stub-1`, and nothing here impersonates a real provider.
 *
 * Contract, mirrored from the provider path the plugin actually calls:
 * - binds 127.0.0.1 only, never 0.0.0.0;
 * - answers POST /zen/v1/chat/completions and POST /v1/chat/completions only — the first is the
 *   path pi-ai's builtin opencode catalog calls, the second is what a hand-configured profile's
 *   `baseURL: http://127.0.0.1:8100/v1` composes (the OpenAI SDK appends `/chat/completions` to the
 *   api root, never a further prefix); every other path or method gets 404;
 * - no `x-opencode-session` header gets 400 `MissingSessionID`, the check that caught the pi-ai route;
 * - usage carries the cache fields in the provider's own shape (`prompt_tokens_details`), and an
 *   absent field is left absent so MOCT records null, not 0.
 *
 * Env:
 * - STUB_ADDR (default 127.0.0.1:8100) and STUB_PORT are the only listen targets;
 * - STUB_CASES: comma list of case ids applied per request, in order; the last one repeats.
 *   Known cases: `cache-read` (cached_tokens populated), `cache-absent` (no cache fields),
 *   `cache-write` (cache_write_tokens populated, no read field);
 * - STUB_429_FIRST=1: the first request gets 429 (optional RecoveryCoordinator exercise; off by default);
 * - RUN_LOG (default /home/ddv/work/fix-llm-logs/cache-stub-run.log): one JSON line per request.
 *
 * The process prints its pid on start. The run log records the start and stop lines, so the pid
 * and kill are on record (criteria item 8).
 */
import http from 'node:http'
import { appendFileSync } from 'node:fs'

const [host, port] = (process.env.STUB_ADDR ?? '127.0.0.1:8100').split(':')
if (host !== '127.0.0.1') throw new Error(`stub must bind 127.0.0.1 only, got ${host}`)
const listenPort = Number(process.env.STUB_PORT ?? port ?? 8100)
const runLog = process.env.RUN_LOG ?? '/home/ddv/work/fix-llm-logs/cache-stub-run.log'
const cases = (process.env.STUB_CASES ?? 'cache-read').split(',').map(id => id.trim()).filter(Boolean)
const first429 = process.env.STUB_429_FIRST === '1'
const ENDPOINTS = new Set(['/zen/v1/chat/completions', '/v1/chat/completions'])
const MODEL = 'cache-stub-1'

let count = 0 // model requests only: drives the case sequence and the 429 slot
let requests = 0 // every request: the log's `n`
let previousAt = 0

function log(entry) {
  appendFileSync(runLog, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

/** The provider-shaped usage block for one case. Absent fields stay absent. */
function usageFor(caseId) {
  const base = { prompt_tokens: 1200, completion_tokens: 12, total_tokens: 1212 }
  if (caseId === 'cache-read') return { ...base, prompt_tokens_details: { cached_tokens: 1000 } }
  if (caseId === 'cache-write') return { ...base, prompt_tokens_details: { cache_write_tokens: 800 } }
  return base
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sse(res, caseId, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const chunk = (delta, finish, usage) => ({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
  })
  res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: `STUB: ${caseId}` }, null))}\n\n`)
  res.write(`data: ${JSON.stringify(chunk({}, 'stop', usageFor(caseId)))}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = http.createServer((req, res) => {
  const now = Date.now()
  const offsetMs = previousAt === 0 ? 0 : now - previousAt
  previousAt = now
  const sessionValue = req.headers['x-opencode-session']
  const sessionPresent = typeof sessionValue === 'string' && sessionValue.length > 0
  // `n` counts every request, so the alignment check (one delivered turn = one stub request) is decidable.
  // It is incremented before any branch, so a 404 or 400 never shares a number with the next request.
  requests += 1
  const n = requests
  // The case sequence and the 429 slot count only requests that reach the model, so a rejected request never shifts them.
  const caseId = cases[Math.min(count, cases.length - 1)]
  const base = { n, offsetMs, method: req.method, path: req.url, sessionHeaderPresent: sessionPresent, sessionValue: sessionPresent ? sessionValue : null, caseId }

  if (req.method !== 'POST' || !ENDPOINTS.has(req.url)) {
    log({ ...base, status: 404 })
    return json(res, 404, { error: { message: 'not found' } })
  }
  if (!sessionPresent) {
    log({ ...base, status: 400, error: 'MissingSessionID' })
    return json(res, 400, { error: { message: 'MissingSessionID', type: 'invalid_request_error' } })
  }
  // Only requests that reach the model count toward the case sequence and the 429 slot.
  const index = count
  count += 1
  // The prompt is not inspected; the body is read only for its size and the stream flag.
  const parts = []
  req.on('data', chunk => parts.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(parts)
    const size = body.length
    let stream = false
    try { stream = JSON.parse(body.toString() || '{}').stream === true } catch { stream = false }
    if (first429 && index === 0) {
      log({ ...base, status: 429, bodyBytes: size, error: 'FreeUsageLimitError (stub)' })
      return json(res, 429, { type: 'FreeUsageLimitError', message: 'Rate limit exceeded. Please try again later.' })
    }
    log({ ...base, status: 200, bodyBytes: size, usage: usageFor(caseId) })
    if (stream) return sse(res, caseId, `stub-${index + 1}`)
    return json(res, 200, {
      id: `stub-${index + 1}`, object: 'chat.completion', created: Math.floor(now / 1000), model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: `STUB: ${caseId}` }, finish_reason: 'stop' }],
      usage: usageFor(caseId),
    })
  })
})

server.listen(listenPort, '127.0.0.1', () => {
  log({ event: 'start', pid: process.pid, addr: `127.0.0.1:${listenPort}`, cases, first429 })
  process.stdout.write(`cache-stub pid=${process.pid} listening 127.0.0.1:${listenPort}\n`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log({ event: 'stop', pid: process.pid, signal, requests, modelRequests: count })
    server.close(() => process.exit(0))
  })
}
