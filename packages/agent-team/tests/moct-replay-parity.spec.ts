/**
 * A1 replay parity: a read-only PROD ledger copy, replayed into a fresh MOCT backend
 * through MoctOperationsTable, must come back record for record and project identically.
 *
 * Re-runnable at every TEST deploy against a fresh PROD copy. Skipped unless the copy
 * path is set, so CI without the copy stays green:
 *   MOCT_A1_LEDGER_COPY=/path/to/agent_team.sqlite   the PROD copy (opened read-only)
 *   MOCT_A1_BASE_URL=http://127.0.0.1:8110          a fresh, EMPTY MOCT backend
 *   MOCT_A1_WORKSPACE=eda6b45f-66d5-49da-864b-6079e4b50e9f   the Team workspace id
 * The backend must be empty: the spec checks that before posting anything.
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AgentTeamLedger } from '../src/ledger.ts'
import { MoctOperationsTable } from '../src/moct-table.ts'

const copyPath = process.env.MOCT_A1_LEDGER_COPY?.trim()
const baseUrl = process.env.MOCT_A1_BASE_URL?.trim() ?? 'http://127.0.0.1:8110'
const workspaceId = process.env.MOCT_A1_WORKSPACE?.trim() ?? 'eda6b45f-66d5-49da-864b-6079e4b50e9f'

/** Canonical dump: Maps and Sets become sorted arrays, object keys are sorted. */
function canon(value: unknown): unknown {
  if (value instanceof Map) return [...value.entries()].map(([k, v]) => [canon(k), canon(v)]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])))
  if (value instanceof Set) return [...value].map(canon).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (Array.isArray(value)) return value.map(canon)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canon((value as Record<string, unknown>)[k])]))
  return value
}

/** In-memory stand-in for the copy's own table: replays in insertion (sequence) order. */
class MemTable {
  private readonly map = new Map<string, unknown>()
  put(key: string, value: unknown): Promise<void> { this.map.set(key, value); return Promise.resolve() }
  get(key: string): unknown { return this.map.get(key) }
  entries(): IterableIterator<[string, unknown]> { return this.map.entries() }
}

function readCopy(path: string): { key: string; value: { sequence: number; kind: string } }[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare('select key, value from u_agent_team_operations order by rowid').all() as { key: string; value: string }[]
    return rows.map(row => ({ key: row.key, value: JSON.parse(row.value) as { sequence: number; kind: string } }))
  } finally {
    db.close()
  }
}

describe('A1 replay parity (PROD copy -> fresh MOCT backend)', () => {
  it.skipIf(copyPath === undefined || copyPath === '')('replays every record through MoctOperationsTable with identical records, counts, and projection', async () => {
    const records = readCopy(copyPath!)
    records.forEach((record, index) => expect(record.value.sequence, 'copy rows are in sequence order').toBe(index + 1))

    // Side A: the copy replayed in memory, the original projection.
    const memory = new MemTable()
    for (const record of records) await memory.put(record.key, record.value)
    const ledgerA = new AgentTeamLedger(memory as never)
    ledgerA.validate()

    // Side B: the same records posted through MoctOperationsTable, then reloaded from the backend.
    const writer = await MoctOperationsTable.open<string, never>({ baseUrl, workspaceId })
    expect([...writer.entries()].length, 'the backend must be empty before the replay').toBe(0)
    for (const record of records) await writer.put(record.key as never, record.value as never)
    const reloaded = await MoctOperationsTable.open<string, unknown>({ baseUrl, workspaceId })
    const ledgerB = new AgentTeamLedger(reloaded as never)
    ledgerB.validate()

    // Records: every row equal after the round trip, in order, nothing extra.
    const stored = [...reloaded.entries()]
    expect(stored.length, 'record count after the round trip').toBe(records.length)
    stored.forEach(([key, value], index) => {
      expect(key).toBe(records[index]!.key)
      expect(JSON.stringify(canon(value)), `row ${index + 1} differs after the round trip`).toBe(JSON.stringify(canon(records[index]!.value)))
    })

    // Counts per kind and the last sequence.
    const countKinds = (kinds: readonly string[]) => kinds.reduce<Record<string, number>>((acc, kind) => ({ ...acc, [kind]: (acc[kind] ?? 0) + 1 }), {})
    expect(countKinds(stored.map(([, value]) => (value as { kind: string }).kind)), 'per-kind counts').toEqual(countKinds(records.map(record => record.value.kind)))
    expect((stored.at(-1)![1] as { sequence: number }).sequence, 'last sequence').toBe(records.length)

    // Projection: the replay of the copy against the replay of the backend log.
    expect(canon((ledgerB as unknown as { state: unknown }).state), 'projection parity').toEqual(canon((ledgerA as unknown as { state: unknown }).state))
  }, 600000)
})
