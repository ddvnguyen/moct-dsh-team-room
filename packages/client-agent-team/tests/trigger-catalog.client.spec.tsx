// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { TeamComposer } from '../src/client/TeamComposer.tsx'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { createTeamTriggerCatalogLoader } from '../src/client/trigger-catalog.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import type { TeamTriggerCatalogItem } from '../src/client/trigger-catalog.ts'

const draftKey = 'channel:channel:test' as never
const translate = ((key: keyof typeof en) => en[key]) as unknown as TeamConversationProps['t']
const catalog: readonly TeamTriggerCatalogItem[] = [
  { kind: 'command', name: 'compact', description: 'Compact the current context' },
  { kind: 'skill', name: 'review', description: 'Review a change' },
]

afterEach(() => cleanup())
beforeEach(() => { localStorage.clear() })

function renderComposer(loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']) {
  const drafts = new TeamDraftStore()
  const onSubmit = vi.fn()
  const view = render(<TeamComposer
    members={[]}
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
  commandResult = { ok: true as const, value: [{ name: 'compact', description: 'Compact context', input: { hint: 'text' } }] },
  skillResult = { ok: true as const, value: { skills: [{ name: 'review', description: 'Review changes' }] } },
}: {
  sessionId?: string
  commandResult?: unknown
  skillResult?: unknown
} = {}) {
  const reference = { binding: { session: { getSnapshot: () => ({ openState: 'open' }) } } }
  const sessions = {
    binding: vi.fn(() => sessionId === undefined ? undefined : {}),
    using: vi.fn(async (_id: unknown, _options: unknown, run: (ref: unknown) => Promise<unknown>) => run(reference)),
  }
  const remotes = {
    commands: { list: vi.fn(async () => commandResult) },
    skills: { list: vi.fn(async () => skillResult) },
  }
  return { sessions, remotes, reference }
}

describe('Team trigger catalog loader', () => {
  it('loads commands and skills together under the retained main Session', async () => {
    const { sessions, remotes } = retainedSessionMocks({ sessionId: 'session:main' })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader(new AbortController().signal)).resolves.toEqual([
      { kind: 'command', name: 'compact', description: 'Compact context', leadingOnly: true },
      { kind: 'skill', name: 'review', description: 'Review changes' },
    ])
    expect(sessions.using).toHaveBeenCalledOnce()
    expect(remotes.commands.list).toHaveBeenCalledWith('session:main')
    expect(remotes.skills.list).toHaveBeenCalledWith({ sessionId: 'session:main' }, expect.any(AbortSignal))
  })

  it('rejects without a retained main Session and never calls either catalog', async () => {
    const { sessions, remotes } = retainedSessionMocks()
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => undefined, sessions: sessions as never, remotes: remotes as never })

    await expect(loader(new AbortController().signal)).rejects.toThrow('require a retained main Session')
    expect(remotes.commands.list).not.toHaveBeenCalled()
    expect(remotes.skills.list).not.toHaveBeenCalled()
  })

  it('rejects the combined catalog if the skill registry fails instead of returning commands only', async () => {
    const { sessions, remotes } = retainedSessionMocks({
      sessionId: 'session:main',
      skillResult: { ok: false as const, error: { message: 'skills offline' } },
    })
    const loader = createTeamTriggerCatalogLoader({ getSessionId: () => 'session:main' as never, sessions: sessions as never, remotes: remotes as never })

    await expect(loader(new AbortController().signal)).rejects.toThrow('skills/list failed: skills offline')
    expect(remotes.commands.list).toHaveBeenCalledOnce()
    expect(remotes.skills.list).toHaveBeenCalledOnce()
  })
})

describe('Team composer command and skill suggestions', () => {
  it('shows both catalog groups and inserts a selected skill trigger into the draft', async () => {
    const loadTriggerCatalog = vi.fn(async () => catalog)
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
    const loadTriggerCatalog = vi.fn(async () => catalog)
    const b = renderComposer(loadTriggerCatalog)
    fireEvent.change(b.input, { target: { value: 'word/skill' } })

    expect(screen.queryByRole('listbox', { name: 'Command and skill suggestions' })).toBeNull()
    expect(loadTriggerCatalog).not.toHaveBeenCalled()
  })

  it('does not open for pasted slash text and leaves native paste unprevented', async () => {
    const loadTriggerCatalog = vi.fn(async () => catalog)
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
    const b = renderComposer(vi.fn(async () => { throw new Error('skills offline') }))
    fireEvent.change(b.input, { target: { value: '/' } })

    expect((await screen.findByRole('alert')).textContent).toContain('Commands and skills are unavailable')
    expect(screen.queryByRole('option')).toBeNull()
  })
})
