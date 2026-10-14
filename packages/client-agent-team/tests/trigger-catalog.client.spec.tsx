// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { TeamComposer } from '../src/client/TeamComposer.tsx'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { createTeamTriggerCatalogLoader } from '../src/client/trigger-catalog.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamTriggerCatalogItem } from '../src/client/trigger-catalog.ts'

const draftKey = 'channel:channel:test' as never
const translate = ((key: keyof typeof en) => en[key]) as unknown as TeamConversationProps['t']
const catalog: readonly TeamTriggerCatalogItem[] = [
  { kind: 'command', name: 'compact', description: 'Compact the current context' },
  { kind: 'skill', name: 'review', description: 'Review a change' },
]

afterEach(() => cleanup())
beforeEach(() => { localStorage.clear() })

function renderComposer(loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog'], members: readonly AgentTeamClientMemberStatus[] = []) {
  const drafts = new TeamDraftStore()
  const onSubmit = vi.fn()
  const view = render(<TeamComposer
    members={members}
    drafts={drafts}
    loadTriggerCatalog={loadTriggerCatalog}
    draftKey={draftKey}
    pending={false}
    onSubmit={onSubmit}
    t={translate}
  />)
  return { ...view, drafts, onSubmit, input: screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement }
}

function retainedSessionMocks({
  sessionId,
  memberSessionId,
  commandResult = { ok: true as const, value: [{ name: 'compact', description: 'Compact context', input: { hint: 'text' } }] },
  skillResult = { ok: true as const, value: { skills: [{ name: 'review', description: 'Review changes' }] } },
}: {
  sessionId?: string
  memberSessionId?: string
  commandResult?: unknown
  skillResult?: unknown
} = {}) {
  const reference = { binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }
  const memberReference = { binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }
  const remotes = {
    commands: { list: vi.fn(async () => commandResult) },
    skills: { list: vi.fn(async () => skillResult) },
  }
  // One ISessions double over two identities: the retained main session
  // answers the Host commands, the Member session answers the scoped skills.
  const binding = (id: unknown): {} | undefined => (id === sessionId || id === (memberSessionId ?? 'session:member') ? {} : undefined)
  const using = async (id: unknown, _options: unknown, run: (ref: unknown) => Promise<unknown>): Promise<unknown> => run(id === sessionId ? reference : memberReference)
  return { sessions: { binding, using }, remotes, reference, memberReference }
}

describe('Team trigger catalog loader', () => {
  it('scopes skills to the selected Member session while Host commands stay on the main Session', async () => {
    const { sessions, remotes } = retainedSessionMocks({ sessionId: 'session:main', memberSessionId: 'session:builder' })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader({ sessionId: 'session:builder' as never, memberHandle: 'builder' }, new AbortController().signal)).resolves.toEqual([
      { kind: 'command', name: 'compact', description: 'Compact context', leadingOnly: true },
      { kind: 'skill', name: 'review', description: 'Review changes', memberHandle: 'builder' },
    ])
    // Commands ride the retained main session; skills ride the Member's own.
    expect(remotes.commands.list).toHaveBeenCalledWith('session:main')
    expect(remotes.skills.list).toHaveBeenCalledWith({ sessionId: 'session:builder' }, expect.any(AbortSignal))
  })

  it('shows an explicit no-session row instead of the Host catalog when the selected Member has no session', async () => {
    const { sessions, remotes } = retainedSessionMocks({ sessionId: 'session:main', memberSessionId: 'session:builder' })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader({ sessionId: undefined, memberHandle: 'idle-agent' }, new AbortController().signal)).resolves.toEqual([
      { kind: 'command', name: 'compact', description: 'Compact context', leadingOnly: true },
      { kind: 'notice', name: 'no-active-session', description: '@idle-agent', memberHandle: 'idle-agent' },
    ])
    expect(remotes.skills.list).not.toHaveBeenCalled()
    expect(remotes.commands.list).toHaveBeenCalledWith('session:main')
  })

  it('rejects without a retained main Session and never calls either catalog', async () => {
    const { sessions, remotes } = retainedSessionMocks()
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => undefined, sessions: sessions as never, remotes: remotes as never })

    await expect(loader({ sessionId: 'session:builder' as never, memberHandle: 'builder' }, new AbortController().signal)).rejects.toThrow('require a retained main Session')
    expect(remotes.commands.list).not.toHaveBeenCalled()
    expect(remotes.skills.list).not.toHaveBeenCalled()
  })

  it('keeps the Host commands and adds a notice row when the Member skill read fails', async () => {
    const { sessions, remotes } = retainedSessionMocks({
      sessionId: 'session:main',
      memberSessionId: 'session:builder',
      skillResult: { ok: false as const, error: { message: 'skills offline' } },
    })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader({ sessionId: 'session:builder' as never, memberHandle: 'builder' }, new AbortController().signal)).resolves.toEqual([
      { kind: 'command', name: 'compact', description: 'Compact context', leadingOnly: true },
      { kind: 'notice', name: 'skills-unavailable', description: '@builder', memberHandle: 'builder' },
    ])
  })

  it('emits no Member notice when no Member is selected, such as a Channel without agents', async () => {
    const { sessions, remotes } = retainedSessionMocks({ sessionId: 'session:main' })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    const items = await loader({ memberHandle: '' }, new AbortController().signal)
    expect(items.map(item => item.kind + ':' + item.name)).toEqual(['command:compact'])
    expect(remotes.skills.list).not.toHaveBeenCalled()
  })

  it('reads a Member Session this client does not retain instead of taking the Host commands down', async () => {
    // Only the main Session is retained here; the Member's is not.
    const { sessions, remotes } = retainedSessionMocks({ sessionId: 'session:main', memberSessionId: 'session:other' })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    const items = await loader({ sessionId: 'session:unretained' as never, memberHandle: 'builder' }, new AbortController().signal)
    expect(items.map(item => item.kind + ':' + item.name)).toEqual(['command:compact', 'skill:review'])
    expect(remotes.skills.list).toHaveBeenCalledWith({ sessionId: 'session:unretained' }, expect.anything())
  })

  it('falls back to the notice row when an unretained Member Session cannot be read either', async () => {
    const { sessions, remotes } = retainedSessionMocks({
      sessionId: 'session:main',
      skillResult: { ok: false as const, error: { message: 'no such session' } },
    })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    const items = await loader({ sessionId: 'session:unretained' as never, memberHandle: 'builder' }, new AbortController().signal)
    expect(items.map(item => item.kind + ':' + item.name)).toEqual(['command:compact', 'notice:skills-unavailable'])
  })

  it('rejects when the Host command catalog fails even though the Member skills read cleanly', async () => {
    const { sessions, remotes } = retainedSessionMocks({
      sessionId: 'session:main',
      memberSessionId: 'session:builder',
      commandResult: { ok: false as const, error: { message: 'commands offline' } },
    })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader({ sessionId: 'session:builder' as never, memberHandle: 'builder' }, new AbortController().signal)).rejects.toThrow('commands/list failed: commands offline')
    expect(remotes.skills.list).toHaveBeenCalledOnce()
  })
})

describe('Team composer command and skill suggestions', () => {
  it('shows both catalog groups and inserts a selected skill trigger into the draft', async () => {
    const loadTriggerCatalog = vi.fn(async () => catalog) as unknown as TeamConversationProps['loadTriggerCatalog']
    const b = renderComposer(loadTriggerCatalog)

    fireEvent.change(b.input, { target: { value: '/' } })

    const listbox = await screen.findByRole('listbox', { name: 'Command and skill suggestions' })
    expect(await screen.findByRole('group', { name: 'Commands' })).toBeTruthy()
    expect(await screen.findByRole('group', { name: 'Skills' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('option', { name: /review/ }))

    await waitFor(() => expect(b.input.value).toBe('/review '))
    expect(b.drafts.getSnapshot(draftKey).draft).toBe('/review ')
    expect(listbox.isConnected).toBe(false)
  })

  it('supports keyboard selection and Escape dismissal', async () => {
    const b = renderComposer(vi.fn(async () => catalog))
    fireEvent.change(b.input, { target: { value: '/' } })
    await screen.findByRole('option', { name: /compact/ })

    fireEvent.keyDown(b.input, { key: 'ArrowDown' })
    fireEvent.keyDown(b.input, { key: 'Enter' })
    await waitFor(() => expect(b.input.value).toBe('/review '))

    fireEvent.change(b.input, { target: { value: '/' } })
    await screen.findByRole('listbox', { name: 'Command and skill suggestions' })
    fireEvent.keyDown(b.input, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Command and skill suggestions' })).toBeNull()
  })

  it('does not open for a slash in the middle of a word', () => {
    const loadTriggerCatalog = vi.fn(async () => catalog) as unknown as TeamConversationProps['loadTriggerCatalog']
    const b = renderComposer(loadTriggerCatalog)
    fireEvent.change(b.input, { target: { value: 'word/skill' } })

    expect(screen.queryByRole('listbox', { name: 'Command and skill suggestions' })).toBeNull()
    expect(loadTriggerCatalog).not.toHaveBeenCalled()
  })

  it('does not open for pasted slash text and leaves native paste unprevented', async () => {
    const loadTriggerCatalog = vi.fn(async () => catalog) as unknown as TeamConversationProps['loadTriggerCatalog']
    const b = renderComposer(loadTriggerCatalog)
    const paste = new Event('paste', { bubbles: true, cancelable: true })

    act(() => {
      b.input.dispatchEvent(paste)
      fireEvent.change(b.input, { target: { value: '/review' } })
    })

    expect(paste.defaultPrevented).toBe(false)
    expect(screen.queryByRole('listbox', { name: 'Command and skill suggestions' })).toBeNull()
    expect(loadTriggerCatalog).not.toHaveBeenCalled()
  })

  it('shows one catalog error and no partial command options if either registry fails', async () => {
    const b = renderComposer((vi.fn(async () => { throw new Error('skills offline') }) as unknown as TeamConversationProps['loadTriggerCatalog']))
    fireEvent.change(b.input, { target: { value: '/' } })

    expect((await screen.findByRole('alert')).textContent).toContain('Commands and skills are unavailable')
    expect(screen.queryByRole('option')).toBeNull()
  })
})


/** One roster row for the selector specs: a live Member with its own Session. */
function memberStatus(memberId: string, handle: string, presence: 'available' | 'working' = 'available'): AgentTeamClientMemberStatus {
  return {
    member: { memberId, workspaceId: 'w1', handle, description: handle + ' description', presetId: 'team-member', state: 'enabled', sessionId: 'session:' + memberId },
    workspaceIds: ['w1'],
    availability: 'active',
    presence,
  } as unknown as AgentTeamClientMemberStatus
}

describe('Team composer agent selector', () => {
  const builder = memberStatus('member:builder', 'builder')
  const worker = memberStatus('member:worker', 'worker', 'working')
  const roster: readonly AgentTeamClientMemberStatus[] = [builder, worker]

  it('shows the selector control and the always-visible indicator with the first member as default', () => {
    const b = renderComposer(vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'], roster)

    // The indicator is on screen without opening anything, and names the
    // default: the first member of this scope's roster.
    const indicator = document.querySelector('[data-team-agent-indicator]')
    expect(indicator?.textContent).toContain('@builder')
    // The picker is a real control listing every member of the scope.
    const picker = screen.getByRole('button', { name: 'Select Agent' })
    expect(picker).toBeTruthy()
    fireEvent.click(picker)
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      expect.stringContaining('@builder'),
      expect.stringContaining('@worker'),
    ])
    expect((options[0] as HTMLElement).getAttribute('aria-selected')).toBe('true')
    void b
  })

  it('seats the indicator and the picker on the toolbar line with the send control', () => {
    renderComposer(vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'], roster)

    // Human review 3690: the agent controls live on the bottom line with attach
    // and send, not on a row of their own above it.
    const toolbar = screen.getByRole('button', { name: 'Send' }).parentElement as HTMLElement
    expect(toolbar.querySelector('[data-team-agent-indicator]')).toBeTruthy()
    expect(toolbar.contains(screen.getByRole('button', { name: 'Select Agent' }))).toBe(true)
  })

  it('keeps a muted no-agent chip and a slash notice when the scope has no agent', async () => {
    const loadTriggerCatalog = vi.fn(async () => [{ kind: 'command', name: 'compact', description: 'Compact' }]) as unknown as TeamConversationProps['loadTriggerCatalog']
    const b = renderComposer(loadTriggerCatalog, [])

    expect(document.querySelector('[data-team-agent-indicator]')).toBeNull()
    expect(document.querySelector('[data-team-no-agent]')?.textContent).toBe('No agent')
    expect(screen.queryByRole('button', { name: 'Select Agent' })).toBeNull()
    fireEvent.change(b.input, { target: { value: '/' } })
    await waitFor(() => expect(document.querySelector('[data-trigger-notice="no-agents"]')).toBeTruthy())
    expect(await screen.findByRole('option', { name: /compact/ })).toBeTruthy()
  })

  it('changes the indicator and the scoped slash catalog when a second agent is picked', async () => {
    const scopes: string[] = []
    const loadTriggerCatalog = vi.fn(async (scope: { memberHandle: string }) => {
      scopes.push(scope.memberHandle)
      return scope.memberHandle === 'builder'
        ? [{ kind: 'skill', name: 'build', description: 'Build it', memberHandle: 'builder' }]
        : [{ kind: 'skill', name: 'work', description: 'Work it', memberHandle: 'worker' }]
    }) as unknown as TeamConversationProps['loadTriggerCatalog']
    const b = renderComposer(loadTriggerCatalog, roster)

    fireEvent.click(screen.getByRole('button', { name: 'Select Agent' }))
    fireEvent.click(screen.getByRole('option', { name: /worker/ }))

    // The indicator now names the picked agent.
    await waitFor(() => expect(document.querySelector('[data-team-agent-indicator]')?.textContent).toContain('@worker'))
    // The slash list reloaded against the picked Member's own scope, and its
    // rows name that Member so a skill never loses its owner.
    fireEvent.change(b.input, { target: { value: '/' } })
    expect(await screen.findByRole('group', { name: 'Skills' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('option').map(option => option.textContent).join('|')).toContain('work'))
    expect(scopes).toContain('worker')
    expect(scopes).not.toContain('')
  })

  it('keeps the indicator and the picker when the scope holds one agent', () => {
    const b = renderComposer(vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'], [builder])

    // One agent is not a reason to hide who is selected.
    expect(document.querySelector('[data-team-agent-indicator]')?.textContent).toContain('@builder')
    fireEvent.click(screen.getByRole('button', { name: 'Select Agent' }))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    void b
  })

  it('drops a stale pick when the scope changes and the picked member is gone', () => {
    const b = renderComposer(vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'], roster)
    fireEvent.click(screen.getByRole('button', { name: 'Select Agent' }))
    fireEvent.click(screen.getByRole('option', { name: /worker/ }))
    expect(document.querySelector('[data-team-agent-indicator]')?.textContent).toContain('@worker')

    // A remount is what a Channel/Thread switch does to this composer; the new
    // scope's roster must decide the default, not the stale pick.
    b.unmount()
    const next = renderComposer(vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'], [builder, memberStatus('member:reviewer', 'reviewer')])
    expect(document.querySelector('[data-team-agent-indicator]')?.textContent).toContain('@builder')
    void next
  })
})
