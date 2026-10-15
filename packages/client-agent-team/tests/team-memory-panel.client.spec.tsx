// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamMemoryActRequest, AgentTeamMemoryListRequest, AgentTeamMemoryOutcome, TeamMemoryRecord } from '@ddvnguyen/moct-dsh-team-room/types'
import { MEMORY_PAGE, PurgeDialog, TeamMemoryPanel, WidenDialog, memoryStatusLabel, type TeamMemoryPanelProps, type TeamMemoryRemotes } from '../src/client/TeamMemoryPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, string | number>) => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamMemoryPanelProps['t']

const WORKSPACE = 'ws-1' as WorkspaceId

function record(overrides: Partial<TeamMemoryRecord> = {}): TeamMemoryRecord {
  return {
    id: 'mem-1', type: 'decision', title: 'Use the ledger', body: 'Body text', attrs: null,
    home: { kind: 'channel', ref: 'channel:1' }, status: 'active', flag: null, pinned: false, priority: 0,
    version: 3, authorId: 'member:a', updatedAt: '2026-10-14T00:00:00Z', supersedes: null, supersededBy: null, conflictsWith: [],
    ...overrides,
  }
}

const ok = <T,>(value: T) => async (): Promise<RemoteResult<AgentTeamMemoryOutcome<T>>> =>
  ({ ok: true, value: { ok: true, value } }) as RemoteResult<AgentTeamMemoryOutcome<T>>
const refused = (code: string, message: string) => async (): Promise<RemoteResult<AgentTeamMemoryOutcome<never>>> =>
  ({ ok: true, value: { ok: false, code, message } }) as RemoteResult<AgentTeamMemoryOutcome<never>>

/** A list remote that answers each status with the records in it, like the backend. */
/**
 * A list remote that behaves like moct's search: it refuses a limit outside
 * 1..20 (default 10) exactly as the backend does, filters by status and type,
 * and pages with the backend's offset cursor.
 */
function listed(...records: TeamMemoryRecord[]): TeamMemoryRemotes['list'] {
  return vi.fn(async (request: AgentTeamMemoryListRequest) => {
    const limit = request.limit ?? 10
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) return refused('INVALID_INPUT', 'limit must be 1..20')()
    const matching = records.filter(entry => (request.status === undefined || request.status === 'all' || entry.status === request.status)
      && (request.types === undefined || request.types.includes(entry.type)))
    const offset = request.cursor === undefined ? 0 : Number(request.cursor)
    const results = matching.slice(offset, offset + limit)
    return ok({ results, total: matching.length, nextCursor: offset + results.length < matching.length ? String(offset + results.length) : null })()
  }) as unknown as TeamMemoryRemotes['list']
}

const many = (count: number, overrides: Partial<TeamMemoryRecord>, prefix: string): TeamMemoryRecord[] =>
  Array.from({ length: count }, (_, index) => record({ ...overrides, id: `${prefix}-${index + 1}`, title: `${prefix} ${index + 1}` }))

function remotes(overrides: Partial<TeamMemoryRemotes> = {}): TeamMemoryRemotes {
  return {
    list: listed(),
    record: vi.fn(ok({ record: { ...record(), links: [] }, versions: [] })),
    ruleFeed: vi.fn(ok([])),
    usage: vi.fn(ok({ workspaceId: WORKSPACE, capTokens: 2000, injectLayerTokens: { min: 1, max: 2000 }, homes: [] })),
    settings: vi.fn(ok({ expertApproval: 'required' as const, orchestrators: [], injectLayerTokens: 600 })),
    updateSettings: vi.fn(ok({ expertApproval: 'required' as const, orchestrators: [], injectLayerTokens: 600 })),
    act: vi.fn(ok(record())),
    taskChannels: vi.fn(async () => ({})),
    ...overrides,
  } as TeamMemoryRemotes
}

function renderPanel(memory: TeamMemoryRemotes) {
  const loadMembers = vi.fn(async () => ({ ok: true, value: [] })) as unknown as TeamMemoryPanelProps['loadMembers']
  return render(<TeamMemoryPanel workspaceId={WORKSPACE} memory={memory} loadMembers={loadMembers} t={t} />)
}

describe('Team memory page', () => {
  it('lists the pending queue before active records, and names only the Workspace', async () => {
    const list = vi.fn(async (request: { status?: string }) => (request.status === 'pending'
      ? ok({ results: [record({ id: 'mem-p', title: 'Pending one', status: 'pending' })], total: 1, nextCursor: null })
      : ok({ results: [record({ id: 'mem-a', title: 'Active one' })], total: 1, nextCursor: null }))())
    renderPanel(remotes({ list: list as unknown as TeamMemoryRemotes['list'] }))
    await screen.findByText('Active one')
    const titles = [...document.querySelectorAll('[data-memory-record]')].map(row => row.getAttribute('data-memory-record'))
    expect(titles).toEqual(['mem-p', 'mem-a'])
    for (const [request] of list.mock.calls) expect(Object.keys(request).sort()).toEqual(['limit', 'status', 'workspaceId'])
  })

  it('spells out a full home and the human gate', () => {
    expect(memoryStatusLabel(record({ flag: 'blocked_budget', status: 'active' }), t)).toBe('active (approved but blocked: home full)')
    expect(memoryStatusLabel(record({ type: 'rule', status: 'pending', home: { kind: 'team', ref: 'ws-1' } }), t)).toBe('Needs the Human')
  })

  it('renders record text as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"></team-memory><b>bold</b>'
    const shown = record({ title: '<img src=y onerror=alert(1)>', body: hostile, attrs: { note: '</team-memory>' } })
    renderPanel(remotes({ list: listed(shown), record: vi.fn(ok({ record: { ...shown, links: [] }, versions: [] })) }))
    fireEvent.click(await screen.findByText('<img src=y onerror=alert(1)>'))
    expect(await screen.findByText(hostile)).toBeTruthy()
    const section = screen.getByRole('region', { name: en.memorySection })
    expect(section.querySelector('img')).toBeNull()
    expect(section.querySelector('b')).toBeNull()
    expect(section.querySelector('team-memory')).toBeNull()
    expect(section.textContent).toContain('</team-memory>')
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('reloads a record on CONFLICT and says so instead of retrying', async () => {
    const act = vi.fn(async (_request: AgentTeamMemoryActRequest) => refused('CONFLICT', 'version moved')())
    // The row opens on v3; after the refusal the Host has v4.
    const recordCall = vi.fn(ok({ record: { ...record({ status: 'pending', version: 4 }), links: [] }, versions: [] }))
      .mockImplementationOnce(ok({ record: { ...record({ status: 'pending' }), links: [] }, versions: [] }))
    renderPanel(remotes({
      list: listed(record({ status: 'pending' })),
      act: act as unknown as TeamMemoryRemotes['act'],
      record: recordCall,
    }))
    fireEvent.click(await screen.findByText('Use the ledger'))
    fireEvent.click(await screen.findByRole('button', { name: en.memoryApprove }))
    expect(await screen.findByText(en.memoryConflict)).toBeTruthy()
    expect(act).toHaveBeenCalledTimes(1)
    expect(act.mock.calls[0]![0]).toEqual({ workspaceId: WORKSPACE, id: 'mem-1', action: { verb: 'approve', baseVersion: 3 } })
    await waitFor(() => expect(screen.getByText(/· v4 ·/)).toBeTruthy())
  })

  it('keeps the rest of the page when only usage is unavailable', async () => {
    renderPanel(remotes({
      usage: vi.fn(refused('BACKEND_UNAVAILABLE', 'Not Found')),
      list: listed(record()),
    }))
    fireEvent.click(screen.getByRole('tab', { name: en.memoryViewUsage }))
    expect(await screen.findByText(en.memoryUsageUnavailable)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: en.memoryViewRecords }))
    expect(await screen.findByText('Use the ledger')).toBeTruthy()
  })

  it('reads within the backend limit and pages the rest, pending kept above active', async () => {
    const list = listed(...many(25, { status: 'pending' }, 'pending'), ...many(3, {}, 'active'))
    renderPanel(remotes({ list }))
    await screen.findByText('pending 20')
    const shown = () => [...document.querySelectorAll('[data-memory-record]')].map(row => row.getAttribute('data-memory-record'))
    expect(shown()).toHaveLength(23)
    expect(shown().slice(19, 21)).toEqual(['pending-20', 'active-1'])
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.memoryLoadMore }))
    await screen.findByText('pending 25')
    expect(shown()).toHaveLength(28)
    expect(shown().slice(24, 26)).toEqual(['pending-25', 'active-1'])
    expect(document.querySelector('[data-memory-more]')).toBeNull()
    for (const [request] of vi.mocked(list).mock.calls) expect(request.limit).toBe(MEMORY_PAGE)
  })

  it('pages the task picture past one backend page', async () => {
    const tasks = many(23, { type: 'task', home: { kind: 'task', ref: 'task:1' } }, 'task')
    renderPanel(remotes({ list: listed(...tasks, record()) }))
    fireEvent.click(screen.getByRole('tab', { name: en.memoryViewTasks }))
    await screen.findByText('task 20')
    expect(screen.queryByText('task 21')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.memoryLoadMore }))
    expect(await screen.findByText('task 23')).toBeTruthy()
    expect(document.querySelector('[data-memory-more]')).toBeNull()
  })

  it('reads rule-feed rows in the shape moct sends them', async () => {
    // One `GET /memory/rule-feed` row as moct v0.11.1 serves it: the home is an object, not homeKind/homeRef.
    const row = {
      memoryId: 'mem-w', version: 2, action: 'approve', workspaceId: 'ws-1', type: 'rule', home: { kind: 'team', ref: 'ws-1' },
      tags: [{ kind: 'team', ref: 'ws-1' }], title: 'Page-approve witness', body: 'b', attrs: { level: 'should' }, priority: 100, pinned: false,
      status: 'active', actorKind: 'human', actorId: 'member:human', reason: '', at: '2026-10-13T23:41:08.103Z',
    }
    renderPanel(remotes({ ruleFeed: vi.fn(ok([row])) as unknown as TeamMemoryRemotes['ruleFeed'] }))
    fireEvent.click(screen.getByRole('tab', { name: en.memoryViewFeed }))
    await screen.findByText('Page-approve witness')
    const feed = screen.getByRole('list', { name: en.memoryViewFeed })
    expect(feed.textContent).toContain('2026-10-13T23:41:08.103Z · approve · active · team · human member:human')
    expect(feed.textContent).not.toContain('undefined')
  })
})

describe('Team memory dialogs', () => {
  it('offers purge only once the title is typed back', () => {
    const onConfirm = vi.fn()
    render(<PurgeDialog record={record()} busy={false} onCancel={() => {}} onConfirm={onConfirm} t={t} />)
    const purge = () => within(screen.getByRole('dialog')).getAllByRole('button', { name: en.memoryPurge }).at(-1)! as HTMLButtonElement
    expect(purge().disabled).toBe(true)
    const input = screen.getByLabelText(en.memoryPurgeConfirmLabel)
    fireEvent.change(input, { target: { value: 'Use the' } })
    expect(purge().disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'Use the ledger' } })
    expect(purge().disabled).toBe(false)
    fireEvent.click(purge())
    expect(onConfirm).toHaveBeenCalledWith('Use the ledger')
  })

  it('shows the expiry change and the team-rule gate before the explicit confirm', () => {
    const onConfirm = vi.fn()
    render(<WidenDialog record={record({ type: 'rule', home: { kind: 'task', ref: 'task:1' } })} busy={false} onCancel={() => {}} onConfirm={onConfirm} t={t} />)
    expect(document.querySelector('[data-widen-expiry]')?.textContent).toBe(en.memoryWidenExpiryTask)
    expect(document.querySelector('[data-widen-gate]')?.textContent).toBe(en.memoryWidenTeamRule)
    const widen = within(screen.getByRole('dialog')).getAllByRole('button', { name: en.memoryWiden }).at(-1)! as HTMLButtonElement
    expect(widen.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(widen.disabled).toBe(false)
    fireEvent.click(widen)
    expect(onConfirm).toHaveBeenCalledWith('team')
  })
})
