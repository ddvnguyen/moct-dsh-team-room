// @vitest-environment jsdom
//
// The Agents list's filter toolbar. The three dimensions narrow the roster,
// and the row that carries them has to stay readable in the narrow rail: the
// count is the last item in flow, so it can never stand over a control, and
// the two filters are menus, so a long label truncates instead of clipping.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { AgentListToolbar, EMPTY_AGENT_FILTERS, type AgentListFilters } from '../src/client/agents/agent-list-toolbar.tsx'
import { TeamAgentsPanel } from '../src/client/TeamAgentsPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The shipped English wording, so a spec reads the copy the reader reads. */
const t = ((key: string, args?: Record<string, string>) => {
  const raw = (en as Record<string, string | undefined>)[key] ?? key
  return args === undefined ? raw : raw.replace(/\{(\w+)\}/gu, (_match, name: string) => args[name] ?? '')
}) as never

/** The menu row a picker prints, by the text it carries. */
function menuRow(label: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(entry => entry.textContent?.includes(label))
  expect(row, `menu row ${label}`).toBeDefined()
  return row!
}

function renderToolbar(filters: AgentListFilters, onChange = vi.fn()) {
  const view = render(<AgentListToolbar filters={filters} onChange={onChange} visible={7} total={7} t={t} />)
  return { view, onChange }
}

describe('the Agents filter toolbar', () => {
  it('carries the count last, so it cannot stand over a control', () => {
    const { view } = renderToolbar(EMPTY_AGENT_FILTERS)
    const toolbar = view.container.querySelector('[data-agent-list-toolbar]')!
    expect(toolbar.lastElementChild?.getAttribute('data-agent-list-count')).not.toBeNull()
    expect(toolbar.lastElementChild?.textContent).toBe('7/7')
    // The filters and the count share one row; the count is outside it, so a
    // squeezed row wraps rather than printing the count over a trigger.
    expect(toolbar.querySelector('[data-agent-list-filters]')?.contains(toolbar.querySelector('[data-agent-list-count]'))).toBe(false)
  })

  it('names each dimension, so two neighbouring triggers are never both a value', () => {
    renderToolbar(EMPTY_AGENT_FILTERS)
    expect(screen.getByRole('button', { name: 'Filter by role: All roles' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter by presence: All presence' })).toBeTruthy()
  })

  it('shows the chosen value in the trigger', () => {
    renderToolbar({ ...EMPTY_AGENT_FILTERS, role: 'leader' })
    expect(screen.getByRole('button', { name: 'Filter by role: Leader' })).toBeTruthy()
  })

  it('offers one reset, and only while a dimension narrows the list', () => {
    const onChange = vi.fn()
    const { view } = renderToolbar(EMPTY_AGENT_FILTERS, onChange)
    expect(view.container.querySelector('[data-agent-list-clear]')).toBeNull()
    view.rerender(<AgentListToolbar filters={{ ...EMPTY_AGENT_FILTERS, query: 'arch' }} onChange={onChange} visible={1} total={7} t={t} />)
    const clear = view.container.querySelector('[data-agent-list-clear]') as HTMLButtonElement
    expect(clear).toBeTruthy()
    expect(clear.getAttribute('aria-label')).toBe('Clear filters')
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(EMPTY_AGENT_FILTERS)
  })

  it('opens a menu that marks the chosen value, and resets on "All"', () => {
    const onChange = vi.fn()
    renderToolbar(EMPTY_AGENT_FILTERS, onChange)
    fireEvent.click(screen.getByRole('button', { name: 'Filter by role: All roles' }))
    expect(menuRow('All roles').getAttribute('aria-current')).toBe('true')
    fireEvent.click(menuRow('Leader'))
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_AGENT_FILTERS, role: 'leader' })
  })
})

const member = (id: string, handle: string, extra: Record<string, unknown> = {}, availability = 'active'): AgentTeamClientMemberStatus => ({
  member: {
    memberId: id,
    sessionId: `session:${id}`,
    handle,
    description: '',
    state: 'active',
    presetId: 'team-member',
    workspaceIds: [],
    ...extra,
  },
  instances: [],
  workspaceIds: ['w1'],
  availability,
  presence: 'available',
  capabilityState: 'applied',
} as unknown as AgentTeamClientMemberStatus)

function renderPanel(members: readonly AgentTeamClientMemberStatus[]) {
  return render(<TeamAgentsPanel
    workspaceId={'w1' as never}
    loadMembers={vi.fn(async () => ({ ok: true as const, value: members })) as never}
    subscribeChanges={(() => () => {}) as never}
    addMember={vi.fn() as never}
    updateMember={vi.fn() as never}
    recoverMember={vi.fn() as never}
    archiveMember={vi.fn() as never}
    joinWorkspace={vi.fn() as never}
    leaveWorkspace={vi.fn() as never}
    loadModels={vi.fn(async () => ({ ok: true as const, value: [] })) as never}
    openMemberSession={vi.fn() as never}
    openAgentDetail={vi.fn() as never}
    onCreatingChange={vi.fn() as never}
    t={t}
  />)
}

/** The Agent rows the list shows, by the handle each one carries. */
function rowNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-agent-row]')].map(row => row.textContent ?? '')
}

describe('the Agents list filters its roster', () => {
  const members = [
    member('member:a', 'Alpha', { role: 'architect' }),
    member('member:b', 'Beta', { role: 'worker' }, 'unavailable'),
  ]

  it('narrows by role, by presence and by the search field', async () => {
    const { container } = renderPanel(members)
    await waitFor(() => expect(rowNames()).toHaveLength(2))
    expect(container.querySelector('[data-agent-list-count]')?.textContent).toBe('2/2')

    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'alpha' } })
    await waitFor(() => expect(rowNames()).toHaveLength(1))
    expect(container.querySelector('[data-agent-list-count]')?.textContent).toBe('1/2')
    fireEvent.change(search, { target: { value: '' } })
    await waitFor(() => expect(rowNames()).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Filter by role: All roles' }))
    fireEvent.click(menuRow('Worker'))
    await waitFor(() => expect(rowNames()).toHaveLength(1))
    expect(rowNames()[0]).toContain('Beta')
    // "All" is the dimension's own reset, and it is in the menu.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by role: Worker' }))
    fireEvent.click(menuRow('All roles'))
    await waitFor(() => expect(rowNames()).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'Filter by presence: All presence' }))
    fireEvent.click(menuRow('Offline'))
    await waitFor(() => expect(rowNames()).toHaveLength(1))
    expect(rowNames()[0]).toContain('Beta')
  })

  it('names the state it reaches when a filter hides everything', async () => {
    const { container } = renderPanel(members)
    await waitFor(() => expect(rowNames()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Filter by presence: All presence' }))
    fireEvent.click(menuRow('Unstable'))
    await waitFor(() => expect(container.querySelector('[data-agent-list-empty]')?.textContent).toBe('No agents match these filters'))
    expect(rowNames()).toHaveLength(0)
  })
})
