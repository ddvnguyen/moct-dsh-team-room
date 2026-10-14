#!/usr/bin/env node
// MOCT Team Room memory migration (L6). Default is a DRY RUN: it validates the
// curated records against the backend's bounds and prints the list and counts;
// it opens no connection. `--write` is a TEST mutation and needs explicit env:
//   MOCT_TEAM_URL=http://127.0.0.1:8110   (loopback, TEST port only)
//   MOCT_MIGRATION_ACTOR=<member id>  (the agent Member who approved the list; never the Human)
// A re-run matches records by (home, type, exact title): same body = unchanged,
// changed body = PATCH with the version read, otherwise POST. Task records use
// the backend's own idempotent upsert on attrs.taskRef.
import { RECORDS, WORKSPACE_ID } from './moct-team-room-records.mjs'
import { keyOf, problems } from './validate.mjs'

const write = process.argv.includes('--write')
const rows = RECORDS.map(record => ({ record, issues: problems(record) }))
const duplicate = rows.map(row => keyOf(row.record)).filter((key, index, all) => all.indexOf(key) !== index)

const counts = {}
for (const { record } of rows) { const k = `${record.home.kind}/${record.type}`; counts[k] = (counts[k] ?? 0) + 1 }
console.log(`MOCT Team Room memory migration — ${write ? 'WRITE' : 'DRY RUN'} — workspace ${WORKSPACE_ID}`)
for (const [index, { record, issues }] of rows.entries()) {
  console.log(`${String(index + 1).padStart(2)}. [${record.home.kind}/${record.type}${record.attrs?.level ? `/${record.attrs.level}` : ''}] ${record.title}  (${[...record.body].length} chars; source: ${record.source})${issues.length === 0 ? '' : `  !! ${issues.join('; ')}`}`)
}
console.log(`total ${rows.length}: ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(' ')}`)
const bad = rows.filter(row => row.issues.length > 0).length
console.log(`invalid=${bad} duplicate-keys=${duplicate.length}`)
if (bad > 0 || duplicate.length > 0) process.exit(1)
if (!write) process.exit(0)

const url = process.env.MOCT_TEAM_URL ?? ''
const actorId = process.env.MOCT_MIGRATION_ACTOR ?? ''
if (!/^http:\/\/127\.0\.0\.1:8110\/?$/.test(url)) { console.error('refusing: MOCT_TEAM_URL must be http://127.0.0.1:8110 (TEST only)'); process.exit(2) }
if (actorId === '') { console.error('refusing: MOCT_MIGRATION_ACTOR is not set'); process.exit(2) }
const base = `${url.replace(/\/$/, '')}/team/v1`
if (!actorId.startsWith('member:')) { console.error('refusing: the actor must be a member: ref, never the Human'); process.exit(2) }
const actor = { kind: 'member', id: actorId }
const call = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json.code ?? ''}`)
  return json
}
const tally = { created: 0, updated: 0, unchanged: 0 }
for (const { record } of rows) {
  const listed = record.type === 'task' ? { results: [] } : await call('GET', `/memory?${new URLSearchParams({ workspaceId: WORKSPACE_ID, expertId: actorId, all: '1', homes: record.home.kind, types: record.type, status: 'active', q: record.title, limit: '20' })}`)
  const existing = listed.results.find(found => found.title === record.title && found.home.kind === record.home.kind && found.home.ref === record.home.ref)
  if (existing !== undefined) {
    if (existing.body === record.body) { tally.unchanged += 1; continue }
    await call('PATCH', `/memory/${encodeURIComponent(existing.id)}`, { baseVersion: existing.version, actor, body: record.body, reason: 'migration re-run' })
    tally.updated += 1
    continue
  }
  const result = await call('POST', '/memory', { type: record.type, title: record.title, body: record.body, ...(record.attrs === undefined ? {} : { attrs: record.attrs }), home: record.home, workspaceId: WORKSPACE_ID, ...(record.type === 'task' ? { taskRef: record.home.ref } : {}), confirmNew: true, actor })
  tally[result.upsert === 'updated' ? 'updated' : result.upsert === 'unchanged' ? 'unchanged' : 'created'] += 1
}
console.log(`written: created=${tally.created} updated=${tally.updated} unchanged=${tally.unchanged}`)
