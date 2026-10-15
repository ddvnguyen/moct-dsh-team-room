// Local mirror of the backend's write bounds (moct src/team-room/memory.ts):
// titles <= 200 chars, bodies <= 2000, per-type attrs, type/home pairing, and
// a credential guard. The backend re-checks everything; this makes a dry run
// fail before any write is attempted.
export const MAX_TITLE = 200
export const MAX_BODY = 2000
export const TYPE_HOMES = { rule: ['channel', 'team'], convention: ['channel', 'team'], decision: ['task', 'channel'], how_to_work: ['expert'], task: ['task'], branch: ['channel'] }
export const ATTR_KEYS = { rule: ['level'], decision: ['decidedBy', 'sourceRef', 'date'], convention: [], how_to_work: [], task: ['taskRef', 'threadRef', 'state', 'owner'], branch: ['repo', 'branch', 'base', 'pr', 'state'] }
const SECRET_SHAPES = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bghp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bBearer\s+[A-Za-z0-9._-]{20,}/i, /\b[A-Fa-f0-9]{32,}\b/, /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S{6,}/i]

/** @returns {string[]} problems for one record (empty = valid) */
export function problems(record) {
  const out = []
  if (!(record.type in TYPE_HOMES)) return [`unknown type ${record.type}`]
  if (!TYPE_HOMES[record.type].includes(record.home.kind)) out.push(`${record.type} cannot live in a ${record.home.kind} home`)
  if (record.home.kind === 'team' && !/^[0-9a-f-]{36}$/.test(record.home.ref)) out.push('team home must be the workspace id')
  if ([...record.title].length === 0 || [...record.title].length > MAX_TITLE) out.push(`title must be 1..${MAX_TITLE} chars`)
  if ([...record.body].length > MAX_BODY) out.push(`body over ${MAX_BODY} chars (${[...record.body].length})`)
  if (record.body.trim() === '' && record.type !== 'task') out.push('body is required')
  const attrs = record.attrs ?? {}
  for (const key of Object.keys(attrs)) if (!ATTR_KEYS[record.type].includes(key)) out.push(`attrs.${key} is not allowed on ${record.type}`)
  if (record.type === 'rule' && !['must', 'should'].includes(attrs.level)) out.push('rule needs attrs.level must|should')
  if (record.type === 'decision') {
    if (!attrs.decidedBy) out.push('decision needs attrs.decidedBy')
    if (!attrs.sourceRef) out.push('decision needs attrs.sourceRef')
    if (attrs.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(attrs.date)) out.push('attrs.date must be YYYY-MM-DD')
  }
  if (record.type === 'task') {
    if (!String(attrs.taskRef ?? '').startsWith('task:')) out.push('task needs attrs.taskRef')
    if (record.home.ref !== attrs.taskRef) out.push("a task record's home must be its attrs.taskRef")
    if (!['open', 'blocked', 'done'].includes(attrs.state)) out.push('task needs attrs.state')
  }
  for (const text of [record.title, record.body, JSON.stringify(attrs)]) if (SECRET_SHAPES.some(shape => shape.test(text))) out.push('looks like a credential')
  return out
}

/** The stable key a re-run matches on: home, type and exact title. */
export const keyOf = record => `${record.home.kind}:${record.home.ref}|${record.type}|${record.title}`
