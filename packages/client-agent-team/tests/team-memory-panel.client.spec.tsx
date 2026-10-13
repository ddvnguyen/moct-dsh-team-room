// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamMemoryActRequest, AgentTeamMemoryOutcome, TeamMemoryRecord } from '@ddvnguyen/moct-dsh-team-room/types'
import { PurgeDialog, TeamMemoryPanel, WidenDialog, memoryStatusLabel, type TeamMemoryPanelProps, type TeamMemoryRemotes } from '../src/client/TeamMemoryPanel.tsx'
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
function listed(...records: TeamMemoryRecord[]): TeamMemoryRemotes['list'] {
  return vi.fn(async (request: { status?: string }) => {
    const results = records.filter(entry => request.status === undefined || request.status === 'all' || entry.status === request.status)
    return ok({ results, total: results.length, nextCursor: null })()
  }) as unknown as TeamMemoryRemotes['list']
}

function remotes(overrides: Partial<TeamMemoryRemotes> = {}): TeamMemoryRemotes {
  return {
    list: vi.fn(ok({ results: [], total: 0, nextCursor: null })),
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
