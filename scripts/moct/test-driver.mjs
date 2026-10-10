#!/usr/bin/env node
/**
 * TEST-only driver for the TEST-1 runtime gates A2 (restart) and A3 (backend outage).
 *
 * It drives the TEST dsh on :3081 through its /api RPC and reads the verdicts from
 * the MOCT backend on :8110, never from its own report. It touches only the TEST
 * units (dsh-test.service, moct-backend.service) and the dsh workspace given by
 * DRIVER_WORKSPACE, which must be a TEST-only workspace. It never names PROD or the
 * Team workspace eda6b45f-.
 *
 *   DRIVER_WORKSPACE=<dsh workspace id on TEST> node scripts/moct/test-driver.mjs a2
 *   DRIVER_WORKSPACE=<dsh workspace id on TEST> node scripts/moct/test-driver.mjs a3
 *
 * Each run prints one JSON line per step and a final PASS/FAIL verdict. Exit 0 only
 * when every assertion holds. A run creates its own channel, so it is safe to repeat.
 */
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH = process.env.DRIVER_DSH_URL ?? 'http://127.0.0.1:3081'
const MOCT = process.env.DRIVER_MOCT_URL ?? 'http://127.0.0.1:8110'
const MOCT_WORKSPACE = process.env.DRIVER_MOCT_WORKSPACE ?? 'dsh-test'
const WORKSPACE = process.env.DRIVER_WORKSPACE
const LEDGER = process.env.DRIVER_LEDGER ?? join(homedir(), 'dsh-test', 'storages', 'agent_team.sqlite')
const RUN = Date.now().toString(36)
const OUTAGE_MS = Number(process.env.DRIVER_OUTAGE_MS ?? 30_000)

const verdicts = []
let rpcSeq = 0
let requestSeq = 0

function log(step, data) {
  process.stdout.write(`${JSON.stringify({ step, at: new Date().toISOString(), ...data })}\n`)
}

function check(name, pass, detail) {
  verdicts.push({ name, pass })
  log('check', { name, pass, ...(detail === undefined ? {} : { detail }) })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function requestId(label) {
  requestSeq += 1
  return `drv-${RUN}-${label}-${requestSeq}`
}

/** One /api RPC call. Resolves to the value, or throws with the Host's error message. */
async function rpc(method, request) {
  const rpcId = `drv-${RUN}-${++rpcSeq}`
  const res = await fetch(`${DSH}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }),
    signal: AbortSignal.timeout(90_000),
  })
  const body = await res.json()
  if (body.result?.ok !== true) {
    const message = body.result?.error?.message ?? JSON.stringify(body)
    throw new Error(`${method}: ${message}`)
  }
  return body.result.value
}

/** Every committed MOCT op of the TEST backend workspace, in sequence order. */
async function mocOps() {
  const out = []
  let after = 0
  for (;;) {
    const res = await fetch(`${MOCT}/team/v1/operations?workspaceId=${MOCT_WORKSPACE}&afterSequence=${after}`)
    if (!res.ok) throw new Error(`moct ops: HTTP ${res.status}`)
    const page = await res.json()
    out.push(...page.operations.map(op => ({ sequence: op.sequence, requestId: op.requestId, kind: op.kind })))
    if (!page.hasMore) break
    after = page.nextAfterSequence
  }
  return out
}

async function mocHead() {
  const res = await fetch(`${MOCT}/team/v1/operations/head?workspaceId=${MOCT_WORKSPACE}`)
  if (!res.ok) throw new Error(`moct head: HTTP ${res.status}`)
  return (await res.json()).sequence
}

/** Rows of the TEST unit's local agent_team.sqlite operations table. */
function localOperationCount() {
  const db = new DatabaseSync(LEDGER, { readOnly: true })
  try {
    return db.prepare('select count(*) as n from u_agent_team_operations').get().n
  } finally {
    db.close()
  }
}

/** Read-only projection of the workspace and one Thread: must not write a row. */
async function projection(threadRef) {
  const view = await rpc('agentTeam/view', { workspaceId: WORKSPACE })
  const history = await rpc('agentTeam/threadHistory', { workspaceId: WORKSPACE, threadRef, limit: 100 })
  return {
    channels: view.channels.map(channel => ({ channelRef: channel.channelRef, name: channel.name, state: channel.state })),
    facts: history.facts,
  }
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (res.status < 500) return true
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) return false
    await sleep(1_000)
  }
}

function systemctl(verb, unit) {
  execFileSync('systemctl', ['--user', verb, unit], { stdio: 'inherit' })
  log('systemctl', { verb, unit, exit: 0 })
}

/** Create the run's own channel and open its Thread with one committed human send. */
async function openRunThread() {
  const channel = await rpc('agentTeam/createChannel', {
    requestId: requestId('channel'),
    workspaceId: WORKSPACE,
    name: `driver-${RUN}`,
    description: 'TEST-1 driver run channel',
  })
  const channelRef = channel.channel.channelRef
  const sent = await rpc('agentTeam/sendMessage', {
    requestId: requestId('open'),
    workspaceId: WORKSPACE,
    channelRef,
    body: `driver ${RUN} opening message`,
  })
  return { channelRef, threadRef: sent.message.threadRef }
}

/** One committed human send into the run channel; the id is explicit so a retry can reuse it. */
async function send(channelRef, label, id = requestId(label)) {
  return rpc('agentTeam/sendMessage', {
    requestId: id,
    workspaceId: WORKSPACE,
    channelRef,
    body: `driver ${RUN} ${label}`,
  })
}

/** A2: committed writes, a service restart, then prefix, projection and head checks. */
async function runA2() {
  const { channelRef, threadRef } = await openRunThread()
  await send(channelRef, 'write-2')
  await send(channelRef, 'write-3')
  const beforeOps = await mocOps()
  const beforeHead = await mocHead()
  const beforeProjection = await projection(threadRef)
  const beforeLocal = localOperationCount()
  log('snapshot', { phase: 'before-restart', head: beforeHead, ops: beforeOps.length, local: beforeLocal })

  systemctl('restart', 'dsh-test.service')
  const up = await waitForHttp(`${DSH}/`, 150_000)
  check('dsh-test answers after restart', up)

  const afterOps = await mocOps()
  const afterProjection = await projection(threadRef)
  const afterHead = await mocHead()
  const prefix = beforeOps.every((op, index) => afterOps[index]?.sequence === op.sequence && afterOps[index]?.requestId === op.requestId)
  check('old op list is an unchanged prefix after restart', prefix, { before: beforeOps.length, after: afterOps.length })
  const requestIds = afterOps.map(op => op.requestId)
  check('no duplicate requestId in the MOCT log', new Set(requestIds).size === requestIds.length)
  check('projection identical after restart', JSON.stringify(afterProjection) === JSON.stringify(beforeProjection))
  check('head unchanged by the restart itself', afterHead === beforeHead, { beforeHead, afterHead })

  const next = await send(channelRef, 'write-after-restart')
  const finalHead = await mocHead()
  check('post-restart write sequence is previous head + 1', next.receipt.sequence === beforeHead + 1 && finalHead === beforeHead + 1, { expected: beforeHead + 1, receipt: next.receipt.sequence, head: finalHead })
  check('local ledger row count unchanged by the writes', localOperationCount() === beforeLocal, { local: localOperationCount(), beforeLocal })
}

/** A3: a send during a backend outage fails closed; retries land exactly once. */
async function runA3() {
  const { channelRef } = await openRunThread()
  const headBefore = await mocHead()
  const localBefore = localOperationCount()
  log('snapshot', { phase: 'before-outage', head: headBefore, local: localBefore })

  // A send started just before the stop: its outcome is whatever the backend committed.
  const inFlightId = requestId('in-flight')
  const inFlight = send(channelRef, 'in-flight', inFlightId)
    .then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }))
  systemctl('stop', 'moct-backend.service')
  const inFlightOutcome = await inFlight
  log('send', { phase: 'in-flight', requestId: inFlightId, outcome: inFlightOutcome.ok ? 'committed' : 'failed', error: inFlightOutcome.error })

  // A send during the outage must fail closed with a visible error.
  const duringId = requestId('during-outage')
  let duringError
  try {
    await send(channelRef, 'during-outage', duringId)
  } catch (error) {
    duringError = error.message
  }
  check('send during outage fails with a visible error', duringError !== undefined, { error: duringError })
  await sleep(Math.max(0, OUTAGE_MS - 2_000))
  const localDuring = localOperationCount()
  check('local ledger unchanged during the outage', localDuring === localBefore, { localBefore, localDuring })

  systemctl('start', 'moct-backend.service')
  const backendUp = await waitForHttp(`${MOCT}/team/v1/operations/head?workspaceId=${MOCT_WORKSPACE}`, 60_000)
  check('moct-backend answers after start', backendUp)

  // The retry of the outage send, under a fresh id, lands once; the in-flight id is retried under its own id.
  const retried = await send(channelRef, 'retry-after-outage')
  const headAfter = await mocHead()
  const ops = await mocOps()
  const counts = new Map()
  for (const op of ops) counts.set(op.requestId, (counts.get(op.requestId) ?? 0) + 1)
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  check('exactly one MOCT op per requestId', duplicated.length === 0, { duplicated })
  check('the failed send is not in the log', !ops.some(op => op.requestId === duringId), { duringId })
  const committedInFlight = inFlightOutcome.ok ? 1 : 0
  check(
    'head advanced only by committed writes',
    headAfter === headBefore + committedInFlight + 1,
    { headBefore, headAfter, committedInFlight, retried: retried.receipt.sequence },
  )
  check('local ledger row count unchanged by the outage and the retry', localOperationCount() === localBefore, { localBefore, local: localOperationCount() })
}

/** Wait until the seat's reply stat count grows past `before`; returns the newest Turn's stat. */
async function waitForReply(threadRef, memberId, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const stats = await rpc('agentTeam/threadReplyStats', { workspaceId: WORKSPACE, threadRef })
    const mine = stats.filter(stat => stat.memberId === memberId && stat.isLastOfTurn)
    if (mine.length > before) return mine[mine.length - 1]
    if (Date.now() > deadline) throw new Error(`no reply from seat within ${timeoutMs} ms`)
    await sleep(3_000)
  }
}

/** The seat's home Session and its runs, read through memberSessions. */
async function seatSessions(memberId) {
  return rpc('agentTeam/memberSessions', { workspaceId: WORKSPACE, memberId })
}

/** Tokens a Turn spent, from its recorded usage (null buckets stay null). */
function turnTokens(stat) {
  const usage = stat.turn.usage
  return {
    uncachedInputTokens: usage.uncachedInputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
  }
}

/** Committed MOCT ops with their kind and payload, for the session-bound check. */
async function mocOpsDetailed() {
  const out = []
  let after = 0
  for (;;) {
    const res = await fetch(`${MOCT}/team/v1/operations?workspaceId=${MOCT_WORKSPACE}&afterSequence=${after}`)
    if (!res.ok) throw new Error(`moct ops: HTTP ${res.status}`)
    const page = await res.json()
    out.push(...page.operations)
    if (!page.hasMore) break
    after = page.nextAfterSequence
  }
  return out
}

/**
 * A5: cold-cache detection on a real model. Warm resume inside the TTL keeps the Session;
 * a resume after the TTL seeds a new Session and binds the Thread with reason cold-restart.
 * Pass/fail is read from the MOCT op log and the per-Turn usage, not from this report.
 */
async function runA5() {
  // DRIVER_A5_MODEL=default adds the seat with no pinned model, so it takes the Host default route.
  const pinned = process.env.DRIVER_A5_MODEL !== 'default'
  const model = pinned ? (process.env.DRIVER_A5_MODEL ?? 'opencode-go/deepseek-v4-flash') : 'default'
  const [provider, modelId] = pinned ? model.split('/') : []
  const presetId = process.env.DRIVER_A5_PRESET ?? 'team-member'
  const ttlSeconds = Number(process.env.DRIVER_A5_TTL_SECONDS ?? 300)
  const handle = `a5-${RUN}`
  const channel = await rpc('agentTeam/createChannel', {
    requestId: requestId('channel'),
    workspaceId: WORKSPACE,
    name: `driver-a5-${RUN}`,
    description: 'TEST-1 A5 driver run channel',
  })
  const channelRef = channel.channel.channelRef
  const added = await rpc('agentTeam/addMember', {
    requestId: requestId('add-seat'),
    workspaceId: WORKSPACE,
    handle,
    description: 'A5 cache probe seat',
    presetId,
    ...(pinned ? { model: { provider, model: modelId } } : {}),
    channelRefs: [channelRef],
  })
  const memberId = added.status.member.memberId
  const sessionFirst = added.status.member.sessionId
  log('seat', { handle, memberId, presetId, requested: model, actualModel: added.status.member.model ?? null, sessionFirst, ttlSeconds })

  const opening = await rpc('agentTeam/sendMessage', {
    requestId: requestId('open'),
    workspaceId: WORKSPACE,
    channelRef,
    body: `@${handle} Reply with the single word "one".`,
  })
  const threadRef = opening.message.threadRef

  // Turn 1: a real model run on a fresh Session.
  const turn1 = await waitForReply(threadRef, memberId, 0, 240_000)
  const after1 = await seatSessions(memberId)
  check('turn 1 recorded usage', turn1.turn.usage !== null, turnTokens(turn1))
  check('turn 1 ran on the seat\'s first Session', after1.current === sessionFirst, { current: after1.current, sessionFirst })

  // Warm: within the TTL, resumeMemberSession must resume the same Session.
  const warm = await rpc('agentTeam/resumeMemberSession', {
    requestId: requestId('resume-warm'),
    workspaceId: WORKSPACE,
    memberId,
    sessionId: sessionFirst,
    threadRef,
  })
  check('warm resume inside the TTL returns resumed with the same sessionId', warm.action === 'resumed' && warm.sessionId === sessionFirst, warm)
  const turn2 = await waitForReply(threadRef, memberId, 1, 240_000)
  check('turn 2 (warm) recorded usage', turn2.turn.usage !== null, turnTokens(turn2))

  // Cold: wait until the last assistant turn is older than the TTL, then resume.
  const lastAssistant = (await seatSessions(memberId)).runs.find(run => run.sessionId === sessionFirst)?.lastAssistantAt
  const dueAt = Date.parse(lastAssistant) + ttlSeconds * 1000 + 5_000
  const waitMs = dueAt - Date.now()
  log('wait', { phase: 'idle-past-ttl', lastAssistantAt: lastAssistant, waitMs })
  if (waitMs > 0) await sleep(waitMs)

  const coldRequestId = requestId('resume-cold')
  const cold = await rpc('agentTeam/resumeMemberSession', {
    requestId: coldRequestId,
    workspaceId: WORKSPACE,
    memberId,
    sessionId: sessionFirst,
    threadRef,
  })
  check('cold resume after the TTL returns seeded-new', cold.action === 'seeded-new' && cold.cache === 'cold', cold)
  check('cold resume issues a different sessionId', cold.sessionId !== sessionFirst, { before: sessionFirst, after: cold.sessionId })

  const ops = await mocOpsDetailed()
  const bind = ops.filter(op => op.kind === 'team/thread-session-bound' && op.requestId === `${coldRequestId}:bind`)
  check('MOCT log has a team/thread-session-bound op with reason cold-restart', bind.length === 1 && JSON.stringify(bind[0]).includes('cold-restart'), { ops: bind.map(op => ({ sequence: op.sequence, requestId: op.requestId })) })

  const sessionsAfterCold = await seatSessions(memberId)
  check('old Session run stays readable through memberSessions', sessionsAfterCold.runs.some(run => run.sessionId === sessionFirst), { runs: sessionsAfterCold.runs.map(run => run.sessionId) })
  check('seat now points at the new Session', sessionsAfterCold.current === cold.sessionId, { current: sessionsAfterCold.current, expected: cold.sessionId })

  // Extra cross-check on the cache buckets, reported alongside the verdict and never in place of it.
  const turn3 = await waitForReply(threadRef, memberId, 2, 240_000)
  check('turn 3 (after cold) recorded usage', turn3.turn.usage !== null, turnTokens(turn3))

  const headAfter = await mocHead()
  const opsAfter = await mocOps()
  const counts = new Map()
  for (const op of opsAfter) counts.set(op.requestId, (counts.get(op.requestId) ?? 0) + 1)
  check('exactly one MOCT op per requestId', [...counts.values()].every(n => n === 1))
  check('MOCT head equals the last sequence', headAfter === opsAfter[opsAfter.length - 1]?.sequence, { headAfter })

  const tokens = [turn1, turn2, turn3].map(turnTokens)
  log('tokens', { phase: 'a5', turns: tokens, ttlSeconds, model })
}

async function main() {
  const phase = process.argv[2]
  if (!['a2', 'a3', 'a5'].includes(phase)) throw new Error('usage: test-driver.mjs a2|a3|a5')
  if (WORKSPACE === undefined || WORKSPACE === '' || WORKSPACE.includes('eda6b45f')) {
    throw new Error('DRIVER_WORKSPACE must name a TEST-only dsh workspace, not the Team workspace eda6b45f-')
  }
  if (phase === 'a2') await runA2()
  else if (phase === 'a3') await runA3()
  else await runA5()
  const failed = verdicts.filter(v => !v.pass)
  log('verdict', { phase, run: RUN, checks: verdicts.length, failed: failed.map(v => v.name), result: failed.length === 0 ? 'PASS' : 'FAIL' })
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch(error => {
  log('error', { message: error.message })
  process.exitCode = 1
})
