// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamMemoryListRequest, TeamMemoryRecord } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamMemoryPanel, splitLevel, type TeamMemoryPanelProps, type TeamMemoryRemotes } from '../src/client/TeamMemoryPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, string | number>) => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamMemoryPanelProps['t']

const record = (o: Partial<TeamMemoryRecord> = {}): TeamMemoryRecord => ({
  id: 'mem-1', type: 'rule', title: 'Rule one', body: 'Body', attrs: { level: 'should' }, home: { kind: 'team', ref: 'ws-1' }, status: 'pending', flag: null,
  pinned: false, priority: 0, version: 1, authorId: 'member:a', updatedAt: '2026-10-14T00:00:00Z', supersedes: null, supersededBy: null, conflictsWith: [], ...o,
})
const wrap = (value: unknown) => async () => ({ ok: true, value: { ok: true, value } })

function mount(all: TeamMemoryRecord[]) {
  const list = vi.fn(async (request: AgentTeamMemoryListRequest) => {
    const matching = all.filter(r => (request.status === undefined || request.status === 'all' || r.status === request.status) && (request.types === undefined || request.types.includes(r.type)))
    return wrap({ results: matching, total: matching.length, nextCursor: null })()
  })
  const memory = {
    list, record: vi.fn(async (r: { id: string }) => wrap({ record: { ...all.find(x => x.id === r.id)!, links: [] }, versions: [] })()),
    ruleFeed: vi.fn(wrap([])), usage: vi.fn(wrap({})), settings: vi.fn(wrap({})), updateSettings: vi.fn(wrap({})), act: vi.fn(wrap({})), taskChannels: vi.fn(async () => ({})),
  } as unknown as TeamMemoryRemotes
  const loadMembers = vi.fn(async () => ({ ok: true, value: [] })) as unknown as TeamMemoryPanelProps['loadMembers']
  render(<TeamMemoryPanel workspaceId={'ws-1' as WorkspaceId} memory={memory} loadMembers={loadMembers} t={t} />)
  return list
}

describe('Memory filter bar', () => {
  it('labels each filter, shows the active state, counts N of M and clears', async () => {
    mount([record({ id: 'a', title: 'A', status: 'active', type: 'decision', attrs: null }), record({ id: 'b', title: 'B' }), record({ id: 'c', title: 'C' })])
    await screen.findByText('A')
    const count = document.querySelector('[data-memory-count]')!
    expect(count.textContent).toBe('3 of 3')
    const clear = screen.getByRole('button', { name: en.memoryClearFilters }) as HTMLButtonElement
    expect(clear.disabled).toBe(true)
    const type = screen.getByLabelText(en.memoryFilterType) as HTMLSelectElement
    expect(type.closest('label')!.hasAttribute('data-active')).toBe(false)
    fireEvent.change(type, { target: { value: 'decision' } })
    await waitFor(() => expect(document.querySelector('[data-memory-count]')!.textContent).toBe('1 of 1'))
    expect(type.closest('label')!.hasAttribute('data-active')).toBe(true)
    expect(document.querySelectorAll('[data-memory-record]').length).toBe(1)
    fireEvent.click(clear)
    await waitFor(() => expect(document.querySelector('[data-memory-count]')!.textContent).toBe('3 of 3'))
    expect(type.value).toBe('')
    expect(clear.disabled).toBe(true)
  })
})

describe('Memory record card', () => {
  it('shows the level as a chip, never a JSON box, and hints on a pending record', async () => {
    mount([record({ attrs: { level: 'must' } })])
    fireEvent.click(await screen.findByText('Rule one'))
    await waitFor(() => expect(document.querySelector('[data-memory-level]')).not.toBeNull())
    expect(document.querySelector('[data-memory-level]')!.textContent).toBe('Must')
    expect(document.querySelector('pre')).toBeNull()
    expect(document.querySelector('[data-memory-pending-hint]')!.textContent).toContain('not enforced until approved')
    expect(document.querySelector('[data-memory-purge]')).not.toBeNull()
  })

  it('keeps other attrs raw and skips the hint on an active record', async () => {
    expect(splitLevel({ level: 'Should', note: 'x' })).toEqual({ level: 'should', rest: { note: 'x' } })
    expect(splitLevel(null)).toEqual({ level: undefined, rest: undefined })
    mount([record({ status: 'active', attrs: { level: 'should' } })])
    fireEvent.click(await screen.findByText('Rule one'))
    await waitFor(() => expect(document.querySelector('[data-memory-level]')!.textContent).toBe('Should'))
    expect(document.querySelector('[data-memory-pending-hint]')).toBeNull()
  })
})
