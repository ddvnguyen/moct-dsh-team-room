#!/usr/bin/env node
// Retracts the records the first migration run wrote under the Team Workspace
// ref (eda6b45f-...), which the Memory tab never queries. Only records whose
// exact (type, title) is in the curated list are touched, and only active or
// pending ones. Default is a DRY RUN (reads only). `--write` is a TEST mutation:
//   MOCT_TEAM_URL=http://127.0.0.1:8110  MOCT_MIGRATION_ACTOR=<member: ref that wrote them>
// A worker may retract only its own records, so the actor must be the original migration actor.
import { RECORDS } from './moct-team-room-records.mjs'

const OLD_WORKSPACE_ID = 'eda6b45f-66d5-49da-864b-6079e4b50e9f'
const write = process.argv.includes('--write')
const url = process.env.MOCT_TEAM_URL ?? ''
const actorId = process.env.MOCT_MIGRATION_ACTOR ?? ''
if (!/^http:\/\/127\.0\.0\.1:8110\/?$/.test(url)) { console.error('refusing: MOCT_TEAM_URL must be http://127.0.0.1:8110 (TEST only)'); process.exit(2) }
if (!actorId.startsWith('member:')) { console.error('refusing: MOCT_MIGRATION_ACTOR must be a member: ref, never the Human'); process.exit(2) }
const base = `${url.replace(/\/$/, '')}/team/v1`
const call = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json.code ?? ''}`)
  return json
}
const wanted = new Set(RECORDS.map(record => `${record.type}|${record.title}`))
const found = []
for (const status of ['active', 'pending']) {
  for (const type of ['rule', 'convention', 'decision']) {
    const listed = await call('GET', `/memory?${new URLSearchParams({ workspaceId: OLD_WORKSPACE_ID, expertId: actorId, all: '1', types: type, status, limit: '20' })}`)
    for (const row of listed.results) if (wanted.has(`${row.type}|${row.title}`)) found.push(row)
  }
}
console.log(`${write ? 'WRITE' : 'DRY RUN'}: ${found.length} old record(s) under ${OLD_WORKSPACE_ID}`)
for (const row of found) console.log(` - [${row.type}/${row.status}] ${row.title}`)
if (!write) process.exit(0)
for (const row of found) await call('POST', `/memory/${encodeURIComponent(row.id)}/retract`, { baseVersion: row.version, actor: { kind: 'member', id: actorId }, reason: 'migrated under the ledger Workspace id' })
console.log(`retracted ${found.length}`)
