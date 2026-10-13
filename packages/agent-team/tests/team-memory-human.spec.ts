import { describe, expect, it } from 'vitest'
import { TeamMemoryClient, TeamMemoryError } from '../src/team-memory.ts'
import { TeamMemoryHuman, memoryOutcome, type TeamMemoryHumanContext } from '../src/team-memory-human.ts'

const WORKSPACE = 'eda6b45f-66d5-49da-864b-6079e4b50e9f'
const HUMAN = 'member:human'
const BUILDER = 'member:builder'
const CHANNEL = 'channel:engineering'
const TASK = 'task:memory-page'

const record = (extra: Record<string, unknown> = {}) => ({
  id: 'mem-1', type: 'rule', title: 'Stage only your files', body: 'Never git add -A.', attrs: null,
  home: { kind: 'channel', ref: CHANNEL }, status: 'active', flag: null, pinned: false, priority: 100, version: 3,
  authorId: BUILDER, updatedAt: '', supersedes: null, supersededBy: null, conflictsWith: [], links: [], ...extra,
})

interface Call { readonly method: string; readonly url: URL; readonly body: Record<string, unknown> | undefined }

/** A scripted backend; `found` is what `memory/get` answers for this Workspace's reader. */
function backend(options: { found?: Record<string, unknown> | undefined; status?: number; failUsage?: boolean } = {}) {
  const calls: Call[] = []
  const found = 'found' in options ? options.found : record()
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown> })
    if (options.status !== undefined && url.pathname !== '/team/v1/memory/get') {
      return Response.json({ ok: false, code: 'CONFLICT', error: 'record changed since version 3' }, { status: options.status })
    }
    if (url.pathname === '/team/v1/memory/get') return Response.json({ records: found === undefined ? [] : [found], missing: found === undefined ? ['mem-1'] : [] })
    if (url.pathname === '/team/v1/memory/usage') {
      if (options.failUsage === true) return Response.json({ ok: false, error: 'not found' }, { status: 404 })
      return Response.json({
        workspaceId: WORKSPACE, capTokens: 2000, injectLayerTokens: { min: 1, max: 2000 },
        homes: [
          { home: { kind: 'channel', ref: CHANNEL }, usedTokens: 40, records: 1, blockedPending: 0, largest: [] },
          { home: { kind: 'expert', ref: BUILDER }, usedTokens: 10, records: 1, blockedPending: 0, largest: [] },
          { home: { kind: 'expert', ref: 'member:elsewhere' }, usedTokens: 10, records: 1, blockedPending: 0, largest: [] },
        ],
      })
    }
    if (url.pathname === '/team/v1/memory/settings') return Response.json({ expertApproval: 'required', orchestrators: [], injectLayerTokens: 1000 })
    if (url.pathname.endsWith('/versions')) return Response.json({ versions: [{ memoryId: 'mem-1', version: 1 }] })
    return Response.json(record({ version: 4 }))
  }) as unknown as typeof fetch
  return { calls, human: new TeamMemoryHuman(new TeamMemoryClient({ fetch: fetchImpl })) }
}

const context = (extra: Partial<TeamMemoryHumanContext> = {}): TeamMemoryHumanContext => ({
  humanId: HUMAN,
  workspaceId: WORKSPACE,
  agentMemberIds: new Set([BUILDER]),
  channelOfTask: taskRef => taskRef === TASK ? CHANNEL : undefined,
  ...extra,
})

async function refused(promise: Promise<unknown>): Promise<TeamMemoryError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof TeamMemoryError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

const writes = (calls: readonly Call[]) => calls.filter(call => call.method !== 'GET' && call.url.pathname !== '/team/v1/memory/get')

describe('Human memory: the actor is the ledger Human', () => {
  it('sends the ledger Human as the actor and drops whatever else an action carries', async () => {
    const { calls, human } = backend()
    await human.act(context(), 'mem-1', { verb: 'approve', baseVersion: 3, actor: { kind: 'member', id: BUILDER }, all: true } as never)
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'POST', body: { baseVersion: 3, actor: { kind: 'human', id: HUMAN } } })])
    expect(writes(calls)[0]!.url.pathname).toBe('/team/v1/memory/mem-1/approve')
    // The record is read back first, as the Human reader of this Workspace.
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ workspaceId: WORKSPACE, expertId: HUMAN, all: '1' })
  })

  it('refuses every call when the ledger has no Human Member, before the backend is asked', async () => {
    const { calls, human } = backend()
    const none = context({ humanId: undefined })
    expect((await refused(human.act(none, 'mem-1', { verb: 'approve', baseVersion: 3 }))).code).toBe('NO_HUMAN')
    expect((await refused(human.list(none, { workspaceId: WORKSPACE as never }))).code).toBe('NO_HUMAN')
    expect((await refused(human.updateSettings(none, { workspaceId: WORKSPACE as never, expertApproval: 'off' }))).code).toBe('NO_HUMAN')
    expect(calls).toEqual([])
  })

  it('accepts only the closed verb set', async () => {
    const { calls, human } = backend()
    for (const verb of ['delete', 'settings', 'supersede', undefined]) {
      expect((await refused(human.act(context(), 'mem-1', { verb, baseVersion: 3 } as never))).code).toBe('INVALID_INPUT')
    }
    expect(calls).toEqual([])
  })

  it('reports a record outside this Workspace as not found and writes nothing', async () => {
    const { calls, human } = backend({ found: undefined })
    expect((await refused(human.act(context(), 'mem-1', { verb: 'retract', baseVersion: 3 }))).code).toBe('NOT_FOUND')
    expect(writes(calls)).toEqual([])
  })
})

describe('Human memory: purge is confirmed at the Host', () => {
  it('refuses a purge without confirm before any backend call', async () => {
    const { calls, human } = backend()
    for (const confirm of [undefined, '', '   ']) {
      expect((await refused(human.act(context(), 'mem-1', { verb: 'purge', confirm } as never))).code).toBe('CONFIRM_REQUIRED')
    }
    expect(calls).toEqual([])
  })

  it('checks confirm against the record the Host reads, not the request', async () => {
    const { calls, human } = backend()
    expect((await refused(human.act(context(), 'mem-1', { verb: 'purge', confirm: 'Stage only' }))).code).toBe('CONFIRM_MISMATCH')
    expect(writes(calls)).toEqual([])
    await human.act(context(), 'mem-1', { verb: 'purge', confirm: 'Stage only your files', reason: 'leaked a path' })
    await human.act(context(), 'mem-1', { verb: 'purge', confirm: 'mem-1' })
    expect(writes(calls).map(call => [call.url.pathname, call.body])).toEqual([
      ['/team/v1/memory/mem-1/purge', { actor: { kind: 'human', id: HUMAN }, reason: 'leaked a path' }],
      ['/team/v1/memory/mem-1/purge', { actor: { kind: 'human', id: HUMAN } }],
    ])
  })
})

describe('Human memory: widen', () => {
  it('needs an explicit confirm', async () => {
    const { calls, human } = backend()
    expect((await refused(human.act(context(), 'mem-1', { verb: 'widen', baseVersion: 3, to: 'team' } as never))).code).toBe('CONFIRM_REQUIRED')
    expect((await refused(human.act(context(), 'mem-1', { verb: 'widen', baseVersion: 3, to: 'team', confirm: 'yes' } as never))).code).toBe('CONFIRM_REQUIRED')
    expect(calls).toEqual([])
  })

  it('takes the wider home ref from the Session and the ledger, never the request', async () => {
    const { calls, human } = backend({ found: record({ home: { kind: 'task', ref: TASK }, type: 'decision' }) })
    await human.act(context(), 'mem-1', { verb: 'widen', baseVersion: 3, to: 'team', confirm: true, ref: 'forged' } as never)
    await human.act(context(), 'mem-1', { verb: 'widen', baseVersion: 3, to: 'channel', confirm: true })
    expect(writes(calls).map(call => call.body?.['to'])).toEqual([{ kind: 'team', ref: WORKSPACE }, { kind: 'channel', ref: CHANNEL }])
  })

  it('refuses a channel widen for a record that is not in a task', async () => {
    const { calls, human } = backend()
    expect((await refused(human.act(context(), 'mem-1', { verb: 'widen', baseVersion: 3, to: 'channel', confirm: true }))).code).toBe('INVALID_INPUT')
    expect(writes(calls)).toEqual([])
  })
})

describe('Human memory: edits and conflicts', () => {
  it('copies only the declared edit and pin fields', async () => {
    const { calls, human } = backend()
    await human.act(context(), 'mem-1', { verb: 'edit', baseVersion: 3, title: 'Stage only your own files', home: { kind: 'team', ref: 'x' }, status: 'active' } as never)
    await human.act(context(), 'mem-1', { verb: 'pin', baseVersion: 4, pinned: true, priority: 10, type: 'rule' } as never)
    expect(writes(calls).map(call => call.body)).toEqual([
      { baseVersion: 3, actor: { kind: 'human', id: HUMAN }, title: 'Stage only your own files' },
      { baseVersion: 4, actor: { kind: 'human', id: HUMAN }, pinned: true, priority: 10 },
    ])
  })

  it('refuses a write without the version the page was shown', async () => {
    const { calls, human } = backend()
    expect((await refused(human.act(context(), 'mem-1', { verb: 'approve' } as never))).code).toBe('INVALID_INPUT')
    expect(writes(calls)).toEqual([])
  })

  it('carries the backend CONFLICT code to the page', async () => {
    const { human } = backend({ status: 409 })
    const outcome = await memoryOutcome(() => human.act(context(), 'mem-1', { verb: 'approve', baseVersion: 2 }))
    expect(outcome).toEqual({ ok: false, code: 'CONFLICT', message: 'record changed since version 3' })
  })

  it('lets a non-memory error through instead of hiding it as a refusal', async () => {
    await expect(memoryOutcome(() => Promise.reject(new Error('host bug')))).rejects.toThrow('host bug')
  })
})

describe('Human memory: settings are a closed set', () => {
  it('sends only the three settings, field by field', async () => {
    const { calls, human } = backend()
    await human.updateSettings(context(), { workspaceId: WORKSPACE as never, expertApproval: 'off', retentionDays: 3, actor: { kind: 'member', id: BUILDER } } as never)
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'PUT', body: { actor: { kind: 'human', id: HUMAN }, expertApproval: 'off' } })])
  })

  it('accepts only agent Members of this Workspace as orchestrators', async () => {
    const { calls, human } = backend()
    expect((await refused(human.updateSettings(context(), { workspaceId: WORKSPACE as never, orchestrators: [BUILDER, HUMAN] }))).code).toBe('INVALID_SETTING')
    expect((await refused(human.updateSettings(context(), { workspaceId: WORKSPACE as never, orchestrators: ['member:elsewhere'] }))).code).toBe('INVALID_SETTING')
    expect(writes(calls)).toEqual([])
    await human.updateSettings(context(), { workspaceId: WORKSPACE as never, orchestrators: [BUILDER, BUILDER] })
    expect(writes(calls)[0]!.body).toEqual({ actor: { kind: 'human', id: HUMAN }, orchestrators: [BUILDER] })
  })

  it("bounds the layer budget by the backend's own min and max", async () => {
    const { calls, human } = backend()
    for (const injectLayerTokens of [0, 2001, 1.5]) {
      expect((await refused(human.updateSettings(context(), { workspaceId: WORKSPACE as never, injectLayerTokens }))).code).toBe('INVALID_SETTING')
    }
    expect(writes(calls)).toEqual([])
    await human.updateSettings(context(), { workspaceId: WORKSPACE as never, injectLayerTokens: 2000 })
    expect(writes(calls)[0]!.body).toEqual({ actor: { kind: 'human', id: HUMAN }, injectLayerTokens: 2000 })
  })

  it('refuses a budget change it cannot bound, and a change naming nothing', async () => {
    const { calls, human } = backend({ failUsage: true })
    expect((await refused(human.updateSettings(context(), { workspaceId: WORKSPACE as never, injectLayerTokens: 1200 }))).code).toBe('BACKEND_UNAVAILABLE')
    expect((await refused(human.updateSettings(context(), { workspaceId: WORKSPACE as never }))).code).toBe('INVALID_SETTING')
    expect(writes(calls)).toEqual([])
  })
})

describe('Human memory: reads', () => {
  it("narrows expert homes to this Workspace's agent Members", async () => {
    const { human } = backend()
    const usage = await human.usage(context())
    expect(usage.homes.map(entry => `${entry.home.kind}:${entry.home.ref}`)).toEqual([`channel:${CHANNEL}`, `expert:${BUILDER}`])
  })

  it('lists with the Human scope and only the declared filters', async () => {
    const { calls, human } = backend()
    await human.list(context(), { workspaceId: WORKSPACE as never, status: 'pending', types: ['rule', 'rule'], limit: 500, channels: 'x', expertId: BUILDER } as never)
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ workspaceId: WORKSPACE, expertId: HUMAN, all: '1', types: 'rule', status: 'pending', limit: '100' })
    expect((await refused(human.list(context(), { workspaceId: WORKSPACE as never, status: 'purged' as never }))).code).toBe('INVALID_INPUT')
  })

  it('reads one record with its links and versions', async () => {
    const { human } = backend()
    const view = await human.record(context(), 'mem-1')
    expect(view.record).toMatchObject({ id: 'mem-1', links: [] })
    expect(view.versions).toEqual([{ memoryId: 'mem-1', version: 1 }])
  })
})
