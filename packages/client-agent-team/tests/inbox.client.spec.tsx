// @vitest-environment jsdom
//
// The Multica-style Team Inbox (Board 8/10): one queue grouped by what it
// asks of the reader — a pending decision card or a Task waiting on the
// Human's accept is 「action required」, a mention or a failed Turn is
// 「attention」, everything else is 「activity」 — with the facet filters and
// their counts, the read and archive actions, and the split view that opens
// the selected row's task detail beside the list.
//
// The severity is derived from what the Host's own projection says plus two
// side reads (the Thread's open decision cards and its failed Turns), so the
// specs drive those doubles the way the page reads them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentTeamChannelRef, AgentTeamDecisionRef, AgentTeamDecisionView, AgentTeamMemberId, AgentTeamMessageRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('en-US')
afterEach(() => { vi.restoreAllMocks(); cleanup() })
beforeEach(() => { localStorage.clear() })

/** One Inbox row as the Host emits it; `workspaceId` tags the source Workspace. */
function inboxRow(workspaceId: string, threadRef: string, overrides: Record<string, unknown> = {}): { readonly workspaceId: string } & Record<string, unknown> {
  return {
    workspaceId,
    channelRef: 'channel:engineering',
    channelName: 'engineering',
    taskNumber: 1,
    task: { taskRef: 'task:1', channelRef: 'channel:engineering', threadRef, status: 'in_progress', resolution: 'open' },
    thread: { threadRef, taskRef: 'task:1', revision: 5 },
    unreadCount: 1,
    directCount: 1,
    previewText: 'Decision needed on the rollout',
    newestSequence: 9,
    newestOccurredAt: '2026-09-13T04:00:00.000Z',
    newestActor: { memberId: 'member:iris', name: 'iris' },
    claimOwners: [],
    ...overrides,
  }
}

/**
 * One open decision card on the Thread the specs below queue, as the #109
 * Remote reports it.
 */
const openDecision: AgentTeamDecisionView = {
  decisionRef: 'decision:thread:decision' as AgentTeamDecisionRef,
  channelRef: 'channel:engineering' as AgentTeamChannelRef,
  threadRef: 'thread:decision' as AgentTeamThreadRef,
  asker: 'member:iris' as AgentTeamMemberId,
  messageRef: 'message:1' as AgentTeamMessageRef,
  context: 'The rollout needs a call.',
  questions: [{ prompt: 'Ship it?', multiple: false, options: [{ label: 'Yes' }, { label: 'No' }], recommended: [0] }],
  status: 'open',
  askedAt: '2026-09-13T03:00:00.000Z',
}

/**
 * The seat width the split view measures. The page reads its own element's
 * box, so the double answers for that element only and leaves every other
 * measurement at zero — the same narrow seat jsdom reports by default.
 */
function wideSeat(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const measured = this.dataset['teamInbox'] === undefined ? 0 : width
    return { width: measured, height: 800, top: 0, left: 0, right: measured, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

/** The severity band headings the list renders, in the order the page prints them. */
function bandLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-inbox-list] h3[data-severity]')].map(node => node.getAttribute('data-severity')!)
}

/** The rows the queue shows, in the order it shows them. */
function queueRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-inbox-list] button[data-severity]')]
}

/** The menu row the filter menu prints, by the text it carries. */
function menuRow(label: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')].find(entry => entry.textContent?.includes(label))
  expect(row, `menu row ${label}`).toBeDefined()
  return row!
}

describe('Team Inbox in Multica style', () => {
  it('groups the queue by what it asks of the reader', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', seedDecisions: [openDecision] })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    b.seedInbox([
      inboxRow('w1', 'thread:decision', { previewText: 'decision row', directCount: 0 }),
      inboxRow('w1', 'thread:review', { previewText: 'review row', directCount: 0, task: { taskRef: 'task:2', channelRef: 'channel:engineering', threadRef: 'thread:review', status: 'in_review', resolution: 'open' } }),
      inboxRow('w1', 'thread:mention', { previewText: 'mention row', directCount: 1 }),
      inboxRow('w1', 'thread:activity', { previewText: 'activity row', directCount: 0 }),
    ])
    b.seedInbox([
      inboxRow('w1', 'thread:decision', { previewText: 'decision row', directCount: 0 }),
      inboxRow('w1', 'thread:review', { previewText: 'review row', directCount: 0, task: { taskRef: 'task:2', channelRef: 'channel:engineering', threadRef: 'thread:review', status: 'in_review', resolution: 'open' } }),
      inboxRow('w1', 'thread:mention', { previewText: 'mention row', directCount: 1 }),
      inboxRow('w1', 'thread:activity', { previewText: 'activity row', directCount: 0 }),
    ])
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 4 unread'))
    fireEvent.click(card)
    // The band a row lands in is the one fact the reader scans for, so the
    // page prints one heading per band that holds rows — and no heading for a
    // band that holds none.
    await waitFor(() => expect(bandLabels()).toEqual(['action_required', 'attention', 'info']))
    // The action-required band holds both kinds the mapping names: the pending
    // decision and the Task waiting on the Human's accept.
    const required = queueRows().filter(row => row.getAttribute('data-severity') === 'action_required')
    expect(required.map(row => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('decision row'),
      expect.stringContaining('review row'),
    ]))
    // The band says what the reader must do, in the band's own words.
    expect(required[0]!.textContent).toContain('Decision needed')
    expect(required[1]!.textContent).toContain('Awaiting your review')
    // A mention is attention, and plain activity is neither.
    const attention = queueRows().filter(row => row.getAttribute('data-severity') === 'attention')
    expect(attention).toHaveLength(1)
    expect(attention[0]!.textContent).toContain('Mentioned you')
    const info = queueRows().filter(row => row.getAttribute('data-severity') === 'info')
    expect(info).toHaveLength(1)
    expect(info[0]!.textContent).toContain('New activity')
    // Each band counts its own rows, so a reader never counts them by hand.
    const counts = [...document.querySelectorAll<HTMLElement>('[data-inbox-list] h3[data-severity]')].map(node => node.textContent)
    expect(counts).toEqual(['Action required2', 'Attention1', 'Activity1'])
    await b.runtime.dispose()
  })

  it('shows a pending decision as action required, and answering it takes the row out of that band', async () => {
    wideSeat(1200)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', seedDecisions: [openDecision] })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [inboxRow('w1', 'thread:decision', { previewText: 'decision row', directCount: 0 })]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 1 unread'))
    fireEvent.click(card)
    // The card is a side read of the Thread, so the row settles into the band
    // once the answer arrives — it starts as plain activity.
    await waitFor(() => expect(bandLabels()).toEqual(['action_required']))
    const row = await b.view.findByRole('button', { name: /decision row/ })
    expect(row.textContent).toContain('Decision needed')
    // The split view opens the row's detail, and the open card answers there.
    fireEvent.click(row)
    const detail = await waitFor(() => {
      const pane = document.querySelector<HTMLElement>('[data-inbox-detail]')
      expect(pane).not.toBeNull()
      return pane!
    })
    const cardElement = detail.querySelector<HTMLElement>('[data-team-decision]')
    expect(cardElement).not.toBeNull()
    expect(cardElement!.getAttribute('data-status')).toBe('open')
    fireEvent.click(detail.querySelector('input[type="radio"]')!)
    fireEvent.click([...detail.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Send')!)
    await waitFor(() => expect(b.answerDecision).toHaveBeenCalled())
    // The answer is committed, so the card is closed and the row has nothing
    // left to ask of the reader.
    await waitFor(() => expect(bandLabels()).toEqual(['info']))
    expect(queueRows()[0]!.textContent).toContain('New activity')
    await b.runtime.dispose()
  })

  it('filters the queue by severity and counts what each filter can reveal', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [
      inboxRow('w1', 'thread:mention', { previewText: 'mention row', directCount: 1 }),
      inboxRow('w1', 'thread:activity', { previewText: 'activity row', directCount: 0 }),
      // A row that is already read belongs to the tail, not to the queue: the
      // unread filter has nothing to reveal in it.
      inboxRow('w1', 'thread:read', { previewText: 'read row', directCount: 0, unreadCount: 0 }),
    ]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 2 unread'))
    fireEvent.click(card)
    await waitFor(() => expect(bandLabels()).toEqual(['attention', 'info']))
    const trigger = await b.view.findByRole('button', { name: 'Filter' })
    fireEvent.click(trigger)
    // Every facet count respects the other active dimensions while ignoring
    // its own, so a count is what picking that value would reveal.
    expect(menuRow('Unread only').textContent).toContain('2')
    expect(menuRow('Attention').textContent).toContain('1')
    expect(menuRow('Activity').textContent).toContain('1')
    // Picking a severity keeps only that band.
    fireEvent.click(menuRow('Attention'))
    await waitFor(() => expect(bandLabels()).toEqual(['attention']))
    expect(queueRows()).toHaveLength(1)
    expect(queueRows()[0]!.textContent).toContain('mention row')
    // The menu says how many filters are in force, and the page names the
    // empty state it reaches when a filter hides everything.
    await waitFor(() => expect(b.view.getByRole('button', { name: 'Filter, 1 active' })).toBeTruthy())
    fireEvent.click(menuRow('Clear filters'))
    await waitFor(() => expect(bandLabels()).toEqual(['attention', 'info']))
    await b.runtime.dispose()
  })

  it('moves the selection with the arrow keys, and never opens a Thread', async () => {
    wideSeat(1200)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [
      inboxRow('w1', 'thread:one', { previewText: 'first row', directCount: 1 }),
      inboxRow('w1', 'thread:two', { previewText: 'second row', directCount: 1 }),
    ]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 2 unread'))
    fireEvent.click(card)
    const list = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-inbox-list]')
      expect(node).not.toBeNull()
      return node!
    })
    // The walk lands on rows, not on the band heading that opens the list: the
    // first key selects the first row.
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('[data-inbox-detail] h2')?.textContent).toContain('first row'))
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    await waitFor(() => expect(document.querySelector('[data-inbox-detail] h2')?.textContent).toContain('second row'))
    // The walk moves the selection and nothing else: the Inbox is still the
    // surface the reader is on.
    expect(b.view.container.querySelector('[data-team-inbox]')).not.toBeNull()
    await b.runtime.dispose()
  })

  it('marks the selected row read through the durable read, and the row leaves the queue', async () => {
    wideSeat(1200)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', seededMessages: [{ body: 'Thread opener', occurredAt: '2026-09-13T03:00:00.000Z' }], seedThreadRef: 'thread:open' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [inboxRow('w1', 'thread:open', { previewText: 'still waiting' })]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 1 unread'))
    fireEvent.click(card)
    const row = await b.view.findByRole('button', { name: /still waiting/ })
    // The unread dot is the row's own statement that it waits.
    expect(row.querySelector('[data-inbox-row-dot]')).not.toBeNull()
    fireEvent.click(row)
    const detail = await waitFor(() => {
      const pane = document.querySelector<HTMLElement>('[data-inbox-detail]')
      expect(pane).not.toBeNull()
      return pane!
    })
    fireEvent.click([...detail.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Mark read')!)
    await waitFor(() => expect(b.readThread).toHaveBeenCalled())
    // The read is durable, so the projection drops the row and the dot with it.
    await waitFor(() => expect(b.view.queryByRole('button', { name: /still waiting/ })).toBeNull())
    expect(document.querySelector('[data-inbox-row-dot]')).toBeNull()
    await b.runtime.dispose()
  })

  it('archives the selected row by unfollowing its Thread, and offers no archive where no unfollow can land', async () => {
    wideSeat(1200)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [
      inboxRow('w1', 'thread:open', {
        previewText: 'still waiting',
        // The Host projects the reader's attention on a Thread they follow;
        // that is what an unfollow can remove.
        attention: { memberId: 'member:human', threadRef: 'thread:open', startSequence: 1, readThroughSequence: 1 },
      }),
      inboxRow('w1', 'thread:tail', { previewText: 'recently active row', channelName: 'delivery', directCount: 0, unreadCount: 0, newestSequence: 2 }),
    ]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 1 unread'))
    fireEvent.click(card)
    fireEvent.click(await b.view.findByRole('button', { name: /still waiting/ }))
    const detail = await waitFor(() => {
      const pane = document.querySelector<HTMLElement>('[data-inbox-detail]')
      expect(pane).not.toBeNull()
      return pane!
    })
    fireEvent.click([...detail.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Archive')!)
    // Archive is the reader's own unfollow: the Thread leaves the Inbox for
    // good, which is the Host's projection settling.
    await waitFor(() => expect(b.changeAttention).toHaveBeenCalledWith(expect.objectContaining({ action: 'unfollow', threadRef: 'thread:open' })))
    // A row the reader does not follow — the 「最近活跃」 tail, which is
    // admitted by participation and carries no attention — has no unfollow to
    // make, so the page does not offer one.
    fireEvent.click(await b.view.findByRole('button', { name: /recently active row/ }))
    const tailDetail = await waitFor(() => {
      const pane = document.querySelector<HTMLElement>('[data-inbox-detail]')
      expect(pane).not.toBeNull()
      return pane!
    })
    expect([...tailDetail.querySelectorAll<HTMLButtonElement>('button')].map(button => button.textContent)).not.toContain('Archive')
    await b.runtime.dispose()
  })

  it('opens the selected row\'s task detail beside the list on a wide seat, and its Thread on a narrow one', async () => {
    wideSeat(1200)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [inboxRow('w1', 'thread:open', {
      previewText: 'still waiting',
      attention: { memberId: 'member:human', threadRef: 'thread:open', startSequence: 1, readThroughSequence: 1 },
    })]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 1 unread'))
    fireEvent.click(card)
    // The split view: the list on the left, the row's task detail on the right.
    expect(document.querySelector('[data-inbox-detail]')).toBeNull()
    fireEvent.click(await b.view.findByRole('button', { name: /still waiting/ }))
    const detail = await waitFor(() => {
      const pane = document.querySelector<HTMLElement>('[data-inbox-detail]')
      expect(pane).not.toBeNull()
      return pane!
    })
    // The detail leads with the Task's own number and the row's gist.
    expect(detail.querySelector('h2')?.textContent).toContain('Task #1')
    expect(detail.textContent).toContain('still waiting')
    // The reader's actions live in the pane: open the Thread, mark it read,
    // archive it.
    const actions = [...detail.querySelectorAll<HTMLButtonElement>('button')].map(button => button.textContent)
    expect(actions).toEqual(expect.arrayContaining(['Open Thread', 'Mark read', 'Archive']))
    // The Thread is still one click away: the detail opens it, the Thread
    // page lives in its own Workspace.
    fireEvent.click([...detail.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Open Thread')!)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dsh.agent-team.navigation') ?? '')).toMatchObject({ threadRef: 'thread:open' }))
    await b.runtime.dispose()
  })

  it('opens the issue as a slice on a narrow seat, where no split view exists', async () => {
    wideSeat(0)
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    const card = await b.view.findByRole('button', { name: 'Inbox' })
    const rows = [inboxRow('w1', 'thread:open', { previewText: 'still waiting' })]
    b.seedInbox(rows)
    b.seedInbox(rows)
    await waitFor(() => expect(card.getAttribute('aria-label')).toBe('Inbox, 1 unread'))
    fireEvent.click(card)
    fireEvent.click(await b.view.findByRole('button', { name: /still waiting/ }))
    // The narrow seat has no second column, so the row opens the issue over
    // the Inbox — the same seam the wide seat's detail uses.
    expect(document.querySelector('[data-inbox-detail]')).toBeNull()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dsh.agent-team.navigation') ?? '')).toMatchObject({ issueRef: 'task:1', issueVariant: 'slice' }))
    await b.runtime.dispose()
  })
})
