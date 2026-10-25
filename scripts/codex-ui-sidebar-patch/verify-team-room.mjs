#!/usr/bin/env node
// Behavioural verification of a MOCT team-room lane, after its systemd unit
// owns the lifecycle again.
//
// The old check was `curl -w "http %{http_code}"` against the lane's own
// listener: it printed `http 200` while the Teams tab rendered an empty room,
// because a lane without MOCT_TEAM_URL / MOCT_TEAM_WORKSPACE falls back to its
// local sqlite store and keeps serving the host happily (2026-10-20 05:38Z).
// HTTP liveness cannot see that failure; the roster can. This module asserts
// what the room *is*:
//
//   1. the unit's process carries the team environment, and the workspace id
//      matches the lane's own team-workspace.id;
//   2. exactly one listener owns the lane's port, and it is the unit's MainPID
//      in the unit's cgroup;
//   3. the MOCT team backend answers for that workspace, and the whole
//      operation log is readable;
//   4. the lane's roster is a bijection with the backend's `team/member-added`
//      ids, and every member's state agrees with the backend's archived set —
//      a lane in sqlite fallback shows a different room, so this is the
//      assertion that fails there;
//   5. the lane answers its own trusted host and refuses a foreign one.
//
// The port, the trusted host and the unit name are read back out of the unit
// file: the unit is the single source of the lane's flags, so this module
// cannot drift from it.
//
// Usage:
//   verify-team-room.mjs --unit-file <path> [--data-dir <dir>] [--lane-url <url>]
//   verify-team-room.mjs --self-test
//
// Exit: 0 = every assertion holds; 1 = at least one failed (the deploy stops);
// 2 = the check could not be set up (bad unit file, bad flags).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUEST_TIMEOUT_MS = 10_000
const PAGE_LIMIT = 1_000
const FOREIGN_HOST = 'evil.example.com'
const MIGRATED_WORKSPACE = 'f61e8134-4367-40c0-afff-b4b9a9b8d90e'

function usageError(message) {
  const error = new Error(message)
  error.exitCode = 2
  return error
}

/**
 * The lane's flags, read back out of the unit file. The fleet's units carry
 * one `ExecStart=` line; a missing flag is a setup failure, never a default
 * this module invents.
 */
export function readUnitFlags(unitFile) {
  const source = readFileSync(unitFile, 'utf8')
  const execStart = source.split('\n').find((line) => line.startsWith('ExecStart=')) ?? ''
  if (!execStart) throw usageError(`${unitFile}: no ExecStart= line`)
  const port = execStart.match(/--port ([0-9]+)/)?.[1]
  if (!port) throw usageError(`${unitFile}: no --port in ExecStart`)
  // The lane's public host is the FIRST --trusted-host: a greedy capture takes
  // the last one, which is a trusted address too and therefore keeps passing
  // while probing the wrong host.
  const trustedHost = execStart.match(/--trusted-host ([^ ]+)/)?.[1]
  if (!trustedHost) throw usageError(`${unitFile}: no --trusted-host in ExecStart`)
  const unit = unitFile.split('/').pop()?.replace(/\.service$/, '')
  if (!unit) throw usageError(`${unitFile}: unit name could not be derived`)
  return { port, trustedHost, unit, execStart }
}

/** The pid listening on the lane's port, or '' when nothing is. */
export function portHolder(port, ss) {
  const output = ss ?? execFileSync('ss', ['-ltnp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return (output.match(new RegExp(`:${port} .*pid=([0-9]+)`)) ?? [])[1] ?? ''
}

/** /proc/<pid>/environ as an object. */
export function processEnv(pid, readFile = readFileSync) {
  const raw = readFile(`/proc/${pid}/environ`, 'utf8')
  const env = {}
  for (const pair of raw.split('\0')) {
    if (!pair) continue
    const at = pair.indexOf('=')
    if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return env
}

function cgroupOf(pid, readFile = readFileSync) {
  try {
    const lines = readFile(`/proc/${pid}/cgroup`, 'utf8').trim().split('\n')
    return lines[lines.length - 1] ?? ''
  } catch {
    return ''
  }
}

function mainPidOf(unit) {
  try {
    return execFileSync('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw usageError(`systemctl --user show ${unit}: no MainPID`)
  }
}

/**
 * Every assertion this module can make, as { name, ok, detail }. They are
 * collected rather than short-circuited: a failing deploy wants the whole
 * picture, not only the first problem.
 *
 * `probe` is the seam the self-test drives; the default reads the real host.
 */
export async function verifyLane(options, probe = {}) {
  const { unitFile, dataDir, laneUrl, pid } = options
  const fetchImpl = probe.fetch ?? ((url, init) => fetch(url, init))
  const envOf = probe.envOf ?? processEnv
  const holderOf = probe.holderOf ?? ((port) => portHolder(port))
  const cgroupOfImpl = probe.cgroupOf ?? cgroupOf

  const { port, trustedHost, unit } = readUnitFlags(unitFile)
  const base = laneUrl ?? `http://127.0.0.1:${port}`
  const results = []
  const record = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }) }

  // 1 — the team environment. DSH_HOME alone is the outage: without the two
  // MOCT_TEAM_* variables the plugin falls back to sqlite and renders nothing.
  let env = {}
  try { env = envOf(pid) } catch (error) { env = {} }
  const backendUrl = (env.MOCT_TEAM_URL ?? '').trim().replace(/\/+$/, '')
  const workspace = (env.MOCT_TEAM_WORKSPACE ?? '').trim()
  record('unit-process-env', backendUrl !== '' && workspace !== '',
    backendUrl ? `${pid} carries ${env.MOCT_TEAM_URL} / ${env.MOCT_TEAM_WORKSPACE}`
      : `${pid} has no MOCT_TEAM_* in /proc/${pid}/environ — the room would be the local sqlite store`)

  if (dataDir !== undefined) {
    let recorded = ''
    try { recorded = readFileSync(`${dataDir}/team-workspace.id`, 'utf8').trim() } catch { recorded = '' }
    record('workspace-id-file', recorded !== '' && recorded === workspace,
      recorded === '' ? `${dataDir}/team-workspace.id is missing`
        : recorded === workspace ? recorded : `${dataDir}/team-workspace.id says ${recorded}, the unit process says ${workspace}`)
  }

  // 2 — one listener, owned by the unit. A second listener on the port, or a
  // hand-started process holding it, is what the old script created by killing
  // whatever `ss` reported.
  const holder = holderOf(port)
  record('single-listener-owner', holder !== '' && holder === String(pid),
    holder === '' ? `nothing listens on :${port}`
      : holder === String(pid) ? `:${port} → ${pid}`
        : `:${port} → ${holder}, the unit's MainPID is ${pid}`)
  const cgroup = cgroupOfImpl(pid)
  record('unit-cgroup', cgroup.endsWith(`/${unit}.service`), cgroup || 'no cgroup readable')

  // 3 — the backend answers for this workspace, and its whole log is readable:
  // one operation cannot carry the roster, so the check pages to head.
  let archived = new Set()
  let backendIds = []
  let backendHead = -1
  let activity = 0
  if (backendUrl && workspace) {
    const timeout = { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    try {
      const head = await (await fetchImpl(`${backendUrl}/team/v1/operations/head?workspaceId=${workspace}`, timeout)).json()
      backendHead = head?.sequence
      record('backend-head', Number.isInteger(backendHead), `sequence ${backendHead}`)
      let after = 0
      for (let page = 0; Number.isInteger(backendHead) && after < backendHead; page += 1) {
        if (page > 200) throw new Error('the backend did not page to head')
        const body = await (await fetchImpl(
          `${backendUrl}/team/v1/operations?workspaceId=${workspace}&afterSequence=${after}&limit=${PAGE_LIMIT}`, timeout,
        )).json()
        for (const operation of body?.operations ?? []) {
          if (operation.kind === 'team/initialized') continue
          activity += 1
          if (operation.kind === 'team/member-added') backendIds.push(operation.data?.member?.memberId ?? '')
          if (operation.kind === 'team/member-archived') archived.add(operation.data?.memberId ?? operation.data?.member?.memberId ?? '')
        }
        const operations = body?.operations ?? []
        const last = operations[operations.length - 1]?.sequence
        if (operations.length === 0 || last === undefined) break
        after = last
      }
      // A room with activity but no member at all cannot be shown, and that is
      // the shape of a wrong workspace id; a workspace that has only recorded
      // team/initialized is genuinely new, and an empty roster is correct for
      // it.
      const rosterOk = backendIds.length > 0 || activity === 0
      record('backend-roster', rosterOk, rosterOk
        ? `${backendIds.length} member-added of ${backendHead} operations`
        : `${activity} operations of activity but no member-added in ${backendHead}: the room would render empty`)
    } catch (error) {
      record('backend-head', false, `${backendUrl} did not answer: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 4 — the lane's roster, compared with the backend's. Member ids, never
  // workspace ids: a member's own workspaceId differs from the ledger's by
  // design. The call goes out under the unit's own trusted host, and it is a
  // request this module builds itself for the same reason as realHostStatus
  // below: `fetch` overwrites Host with the URL's authority, so the lane would
  // answer a trust check on the wrong host while the report claims the right
  // one.
  let laneMembers = []
  let laneRpcOk = false
  let laneStatus = 0
  try {
    const postJson = probe.postJson ?? ((path, host, body) => realPostJson(base, path, host, body))
    const response = await postJson('/api/agentTeam/members', trustedHost, {
      type: 'client-request', rpcId: 'verify-team-room', method: 'agentTeam/members', payload: { args: { request: {} } },
    })
    laneStatus = response.status
    let payload
    try { payload = await response.json() } catch { payload = undefined }
    laneRpcOk = response.ok && payload?.result?.ok === true
    laneMembers = laneRpcOk ? payload.result.value : []
    record('lane-roster', laneRpcOk,
      laneRpcOk ? `${laneMembers.length} members over ${base} (POST Host: ${trustedHost} → ${laneStatus})`
        : payload === undefined ? `${base} answered ${laneStatus} without the members envelope (POST Host: ${trustedHost})`
          : `${base} answered ${laneStatus}: ${JSON.stringify(payload).slice(0, 160)}`)
  } catch (error) {
    record('lane-roster', false, `${base} did not answer: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (laneRpcOk) {
    const laneIds = new Set(laneMembers.map((entry) => entry.member?.memberId))
    const backendSet = new Set(backendIds)
    const missing = backendIds.filter((id) => id && !laneIds.has(id))
    const extra = [...laneIds].filter((id) => id && !backendSet.has(id))
    const stateDrift = laneMembers
      .filter((entry) => (entry.member?.state === 'archived') !== archived.has(entry.member?.memberId))
      .map((entry) => entry.member?.handle)
    const identical = missing.length === 0 && extra.length === 0 && stateDrift.length === 0
    record('roster-bijection', identical,
      identical ? `${laneIds.size} members, identical ids and states to the backend`
        : `missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} stateDrift=${JSON.stringify(stateDrift)} — not the room the backend replays`)
  }

  // 5 — the trusted host the unit names, and one that is not on its list.
  const hostStatus = probe.hostStatus ?? ((host) => realHostStatus(base, host))
  const trusted = await hostStatus(trustedHost)
  const foreign = await hostStatus(FOREIGN_HOST)
  record('trusted-host', trusted === 200 && foreign === 403,
    `Host: ${trustedHost} → ${trusted}, Host: ${FOREIGN_HOST} → ${foreign}`)

  return results
}

/**
 * The status of `/` under one `Host:` header. `fetch` cannot be used here:
 * undici overwrites the Host header with the URL's authority, so every probe
 * would come back trusted and the assertion would pass for the wrong reason.
 */
function realHostStatus(base, host) {
  const url = new URL(base)
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: '/',
      method: 'GET',
      headers: { Host: host },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', () => resolve(0))
    req.on('timeout', () => { req.destroy(); resolve(0) })
    req.end()
  })
}

/**
 * A JSON POST under an explicit `Host:` header — the same rule as
 * `realHostStatus`: `fetch` overwrites Host with the URL's authority, so the
 * lane's trust check would be made against `127.0.0.1` while the report claims
 * the unit's public host. The status comes back unmodified so the caller can
 * print what the lane actually answered.
 */
function realPostJson(base, path, host, body) {
  const url = new URL(path, `${base}/`)
  const payload = Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { Host: host, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`the lane did not answer within ${REQUEST_TIMEOUT_MS}ms`)) })
    req.end(payload)
  })
}

export function render(results) {
  const failed = results.filter((result) => !result.ok)
  const width = Math.max(...results.map((result) => result.name.length))
  return {
    failed,
    text: results.map((result) => `${result.ok ? 'ok  ' : 'FAIL'}  ${result.name.padEnd(width)}  ${result.detail}`).join('\n'),
  }
}

/**
 * The deploy's post-check: exit 1 when any assertion fails, so a lane in
 * sqlite fallback fails the deploy instead of shipping an empty room.
 */
export async function main(argv, probe) {
  const args = new Map()
  let selfTest = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--self-test') selfTest = true
    else if (token.startsWith('--') && index + 1 < argv.length) args.set(token.slice(2), argv[++index])
    else throw usageError(`unexpected argument '${token}'`)
  }
  if (selfTest) return selfTestMain()

  const unitFile = args.get('unit-file')
  if (!unitFile) throw usageError('usage: verify-team-room.mjs --unit-file <path> [--data-dir <dir>] [--lane-url <url>]')

  const results = await verifyLane({
    unitFile,
    dataDir: args.get('data-dir'),
    laneUrl: args.get('lane-url'),
    pid: mainPidOf(readUnitFlags(unitFile).unit),
  }, probe)
  const { failed, text } = render(results)
  console.log(text)
  if (failed.length > 0) {
    console.error(`\nverify-team-room: ${failed.length} of ${results.length} assertions failed — the lane is not serving the migrated room.`)
    return 1
  }
  console.log(`\nverify-team-room: ${results.length} of ${results.length} assertions hold.`)
  return 0
}

/**
 * Fixtures for the room shapes the deploy must tell apart, so the check's own
 * behaviour is testable without a lane: the healthy room the deploy must pass,
 * and the two shapes the sqlite fallback produces.
 */
export async function selfTestMain(log = console.log) {
  const unitFile = `${dirname(fileURLToPath(import.meta.url))}/fixtures/verify-team-room/dsh-rehearsal.service`
  const healthy = {
    env: { MOCT_TEAM_URL: 'http://127.0.0.1:8210', MOCT_TEAM_WORKSPACE: MIGRATED_WORKSPACE },
    members: [
      { member: { memberId: 'member:a', handle: 'Architect', state: 'enabled' } },
      { member: { memberId: 'member:b', handle: 'Lead', state: 'archived' } },
    ],
    operations: [
      { sequence: 1, kind: 'team/member-added', data: { member: { memberId: 'member:a' } } },
      { sequence: 2, kind: 'team/member-added', data: { member: { memberId: 'member:b' } } },
      { sequence: 3, kind: 'team/member-archived', data: { memberId: 'member:b' } },
    ],
    head: 3,
    holder: '4140',
    cgroup: '/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-rehearsal.service',
  }
  // Shape 1 of the 05:38Z outage: the hand-launch dropped the team
  // environment, so there is no backend to read and the plugin opens its own
  // local store.
  const envDropped = { ...healthy, env: { DSH_HOME: '/mnt/workspace/clouds/dsh-x/data/home' } }
  // Shape 2: the environment survived but the lane answers for a different
  // room — what a lane reading its local store looks like once the store has
  // its own members.
  const staleRoom = { ...healthy, members: [{ member: { memberId: 'member:z', handle: 'Orchestrator', state: 'enabled' } }] }

  const cases = [
    ['healthy lane, migrated room', healthy, 0],
    ['env dropped, no backend (the 05:38Z outage)', envDropped, 1],
    ['lane answers for another room', staleRoom, 1],
  ]
  let bad = 0
  for (const [name, overrides, expected] of cases) {
    const results = await verifyLane({ unitFile, pid: overrides.holder }, fixtureProbe(overrides))
    const { failed } = render(results)
    const exitCode = failed.length === 0 ? 0 : 1
    if (exitCode === expected && (expected !== 0 || failed.length === 0)) {
      log(`ok    ${name} — ${results.length - failed.length}/${results.length} assertions held, exit ${exitCode}`)
      continue
    }
    bad += 1
    log(`FAIL  ${name} — exit ${exitCode}, expected ${expected}`)
    log(render(results).text)
  }
  log(bad === 0
    ? 'verify-team-room --self-test: the healthy room passes and both fallback shapes fail, as the deploy needs.'
    : `verify-team-room --self-test: ${bad} case(s) behaved wrong.`)
  return bad === 0 ? 0 : 1
}

/** The probe behind the self-test: one lane, one backend, trusted-host aware. */
function fixtureProbe(fixture) {
  const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body })
  const trustedHosts = new Set(['dsh-x.ddvnguyen.com', 'localhost', '127.0.0.1'])
  const fixtureFetch = async (url) => {
    if (url.includes('/team/v1/operations/head')) return response({ sequence: fixture.head })
    if (url.includes('/team/v1/operations?')) return response({ workspaceId: MIGRATED_WORKSPACE, operations: fixture.operations })
    return response({ error: 'not found' }, 404)
  }
  return {
    fetch: fixtureFetch,
    postJson: async (path, host, body) => response({
      type: 'server-response', rpcId: body?.rpcId ?? 'verify-team-room', result: { ok: true, value: fixture.members },
    }),
    envOf: () => fixture.env,
    holderOf: () => fixture.holder,
    cgroupOf: () => fixture.cgroup,
    hostStatus: async (host) => (trustedHosts.has(host) ? 200 : 403),
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(`verify-team-room: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = error.exitCode ?? 2
    })
}
