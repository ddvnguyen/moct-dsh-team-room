/**
 * MoctOperationsTable against the MOCT Team Room contract (§2, §6 A1–A3).
 * The fake backend below implements the same statuses the real backend returns:
 * 201 stored, 200 replay of the same record, 409 SEQUENCE_CONFLICT and
 * OPERATION_ID_CONFLICT. The live TEST backend is measured separately (see report).
 */
import { describe, expect, it } from 'vitest'
import { MoctOperationsTable, MoctTeamError } from '../src/moct-table.ts'

type Rec = { operationId: string; sequence: number; kind: string; [key: string]: unknown }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** In-memory stand-in for /team/v1/operations with the backend's rules. */
function fakeBackend(options: { failNextPosts?: number; hangNextPosts?: number; postStatus?: number; pageCap?: number } = {}) {
  const logs = new Map<string, Rec[]>()
  const byId = new Map<string, { workspaceId: string; record: Rec }>()
  let failures = options.failNextPosts ?? 0
  let hangs = options.hangNextPosts ?? 0
  let posts = 0
  const fetchImpl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.pathname !== '/team/v1/operations') return json(404, { ok: false })
    if (init?.method === 'POST') {
      posts++
      if (hangs > 0) {
        // A hung backend: never answers, only the caller's abort signal ends the request.
        hangs--
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
        })
      }
      if (failures > 0) {
        failures--
        throw new TypeError('fetch failed')
      }
      if (options.postStatus) return json(options.postStatus, { ok: false })
      const body = JSON.parse(String(init.body)) as { workspaceId: string; record: Rec }
      const existing = byId.get(body.record.operationId)
      if (existing) {
        return canonical(existing.record) === canonical(body.record)
          ? json(200, body)
          : json(409, { ok: false, code: 'OPERATION_ID_CONFLICT', error: 'operationId already stored with a different record' })
      }
      const log = logs.get(body.workspaceId) ?? []
      if (log.some(r => r.sequence === body.record.sequence)) {
        return json(409, { ok: false, code: 'SEQUENCE_CONFLICT', error: 'sequence already stored' })
      }
      log.push(body.record)
      logs.set(body.workspaceId, log)
      byId.set(body.record.operationId, body)
      return json(201, body)
    }
    const ws = url.searchParams.get('workspaceId') ?? ''
    const after = Number(url.searchParams.get('afterSequence') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 500)
    const log = (logs.get(ws) ?? []).filter(r => r.sequence > after).sort((a, b) => a.sequence - b.sequence)
    const page = log.slice(0, Math.min(limit, options.pageCap ?? limit))
    return json(200, { workspaceId: ws, operations: page, hasMore: log.length > page.length, nextAfterSequence: page.at(-1)?.sequence ?? after })
  }) as typeof fetch
  return { fetch: fetchImpl, logs, get posts() { return posts } }
}

const rec = (sequence: number, extra: Record<string, unknown> = {}): Rec => ({
  operationId: `operation:${sequence}`,
  sequence,
  kind: 'team/message-sent',
  ...extra,
})

const sleepless = async () => {}

describe('MoctOperationsTable — replay (A1, A2)', () => {
  it('replays every stored operation in sequence order after a fresh open', async () => {
    const backend = fakeBackend()
    const first = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    for (const seq of [1, 2, 3]) await first.put(`operation:${seq}` as string, rec(seq))

    // A restart is a new open against the same backend.
    const reopened = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    expect(reopened.size).toBe(3)
    expect([...reopened.entries()].map(([, value]) => (value as Rec).sequence)).toEqual([1, 2, 3])
    expect(reopened.get('operation:2')).toEqual(rec(2))
  })

  it('pages through a long log on open, in order, with no gaps', async () => {
    // The fake caps each page at 2, so opening 7 records takes four requests.
    const backend = fakeBackend({ pageCap: 2 })
    const writer = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    for (let seq = 1; seq <= 7; seq++) await writer.put(`operation:${seq}` as string, rec(seq))
    const reopened = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    expect([...reopened.entries()].map(([, value]) => (value as Rec).sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps two workspaces apart', async () => {
    const backend = fakeBackend()
    const a = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    const b = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-b', fetch: backend.fetch, sleep: sleepless })
    await a.put('operation:1', rec(1))
    await b.put('operation:1', rec(1, { operationId: 'operation:1' }))
    expect(a.size).toBe(1)
    expect(b.size).toBe(1)
  })

  it('round-trips the board Task kinds as opaque records', async () => {
    // MOCT stores `record_json` opaquely and validates no kind, so the two
    // board kinds must survive a write and a reload byte for byte.
    const backend = fakeBackend()
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    const created: Rec = {
      operationId: 'operation:1', sequence: 1, kind: 'team/task-created',
      data: { workspaceId: 'workspace:alpha', mentions: [],
        message: { messageRef: 'message:board', channelRef: 'channel:eng', threadRef: 'thread:board', taskRef: 'task:board', sender: 'member:human', body: 'Ship the board', topLevel: true, sequence: 1, occurredAt: '2026-10-18T00:00:00.000Z' },
        task: { taskRef: 'task:board', channelRef: 'channel:eng', threadRef: 'thread:board', status: 'todo', resolution: 'open', title: 'Ship the board', priority: 'high', assignee: null, position: 3 },
        thread: { threadRef: 'thread:board', taskRef: 'task:board', revision: 1 },
        inbox: { unread: {}, direct: {} } },
    }
    const updated: Rec = {
      operationId: 'operation:2', sequence: 2, kind: 'team/task-updated',
      data: { workspaceId: 'workspace:alpha', baseRevision: 1, patch: { assignee: null, position: 5 },
        task: { taskRef: 'task:board', channelRef: 'channel:eng', threadRef: 'thread:board', status: 'todo', resolution: 'open', title: 'Ship the board', priority: 'high', assignee: null, position: 5 },
        thread: { threadRef: 'thread:board', taskRef: 'task:board', revision: 2 },
        inbox: { unread: {}, direct: {} } },
    }
    await table.put('operation:1', created)
    await table.put('operation:2', updated)
    const reopened = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    expect(reopened.get('operation:1')).toEqual(created)
    expect(reopened.get('operation:2')).toEqual(updated)
  })
})

describe('MoctOperationsTable — fail-closed writes (A3)', () => {
  it('retries a dropped request with the same operationId and stores once', async () => {
    const backend = fakeBackend({ failNextPosts: 2 })
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    await table.put('operation:1', rec(1))
    expect(backend.logs.get('host-a')?.length).toBe(1)
    expect(table.size).toBe(1)
  })

  it('a write that never reaches the backend changes nothing locally', async () => {
    const backend = fakeBackend({ failNextPosts: 99 })
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    await expect(table.put('operation:1', rec(1))).rejects.toThrow('fetch failed')
    expect(table.size).toBe(0)
    expect(table.get('operation:1')).toBeUndefined()
  })

  it('does not retry a 409 conflict and surfaces its code', async () => {
    const backend = fakeBackend()
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    await table.put('operation:1', rec(1))
    const clash = table.put('operation:2', rec(1, { operationId: 'operation:2' }))
    await expect(clash).rejects.toMatchObject({ status: 409, code: 'SEQUENCE_CONFLICT' })
    expect(table.size).toBe(1)
  })

  it('refuses a key that does not match the record', async () => {
    const backend = fakeBackend()
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    await expect(table.put('operation:9', rec(1))).rejects.toBeInstanceOf(MoctTeamError)
  })

  it('is append-only: delete is refused', async () => {
    const backend = fakeBackend()
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless })
    await expect(table.delete('operation:1')).rejects.toMatchObject({ code: 'APPEND_ONLY' })
  })

  it('times out a hung write and retries it with the same operationId (R1)', async () => {
    const backend = fakeBackend({ hangNextPosts: 2 })
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless, requestTimeoutMs: 20 })
    await table.put('operation:1', rec(1))
    expect(backend.posts).toBe(3)
    expect(table.size).toBe(1)
    expect(backend.logs.get('host-a')?.map(r => r.operationId)).toEqual(['operation:1'])
  })

  it('a backend that never answers fails the write closed and leaves no local state (R1, A3)', async () => {
    const backend = fakeBackend({ hangNextPosts: 99 })
    const table = await MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: backend.fetch, sleep: sleepless, requestTimeoutMs: 20 })
    await expect(table.put('operation:1', rec(1))).rejects.toBeDefined()
    expect(backend.posts).toBe(4)
    expect(table.size).toBe(0)
  })

  it('a backend that never answers fails open instead of hanging the ledger (R1)', async () => {
    const hung = (async (_input: string | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })) as typeof fetch
    await expect(MoctOperationsTable.open({ baseUrl: 'http://x', workspaceId: 'host-a', fetch: hung, sleep: sleepless, requestTimeoutMs: 20 })).rejects.toBeDefined()
  })
})
