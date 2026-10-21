// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'
import type { AgentTeamDecisionRef, AgentTeamDecisionView, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** One event row as the Host's workspaceActivity aggregate emits it. */
function eventRow(sequence: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sequence,
    at: '2026-09-13T04:00:00.000Z',
    kind: 'team/message-sent',
    actor: 'builder',
    summary: `event ${sequence}`,
    ...overrides,
  }
}

function aggregate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totals: { messages: 2, turns: 1, tokensIn: 100, tokensOut: 40, cacheRead: 0, cacheWrite: 0, toolCalls: 2, runMs: 1500, failedTurns: 1, unrecordedTurns: 0 },
    perAgent: [{ memberId: 'member:builder', messages: 2, turns: 1, tokensIn: 100, tokensOut: 40, cacheRead: 0, cacheWrite: 0, toolCalls: 2, runMs: 1500, failedTurns: 1, sessionIds: ['session:builder'] }],
    perDay: [{ day: '2026-09-13', tokensIn: 100, tokensOut: 40, runMs: 1500, perAgent: [{ memberId: 'member:builder', tokensIn: 100, tokensOut: 40, runMs: 1500 }] }],
    sessions: [],
    events: [eventRow(2), eventRow(1, { kind: 'team/turn-failure-notice', actor: 'builder', summary: 'turn 3 failed: provider refused to answer', threadRef: 'thread:1' })],
    ...overrides,
  }
}

function decisionView(threadRef: string, overrides: Partial<AgentTeamDecisionView> = {}): AgentTeamDecisionView {
  return {
    decisionRef: `decision:${threadRef}` as AgentTeamDecisionRef,
    channelRef: 'channel:engineering' as never,
    threadRef: threadRef as AgentTeamThreadRef,
    asker: 'member:builder' as AgentTeamMemberId,
    messageRef: 'message:ask' as never,
    context: 'Roll out now or wait for the freeze?',
    questions: [{ prompt: 'Roll out now?', multiple: false, options: [{ label: 'Now' }, { label: 'Wait' }], recommended: [0] }],
    status: 'open',
    askedAt: '2026-09-13T03:00:00.000Z',
    ...overrides,
  }
}

/**
 * The Overview page mounts in one surface: the Overview section of the Team
 * Detail page, the side menu's team row. The native tab and the conversation
 * face that used to carry it are gone, so the specs pin the page through the
 * page that owns it.
 */
async function openTeamDetail(seed?: Parameters<typeof runtimeWithTeam>[0]) {
  localStorage.setItem('dsh.agent-team.navigation', JSON.stringify({ mode: 'team', workspaceId: 'w1' }))
  const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', ...seed })
  fireEvent.click(await b.view.findByRole('button', { name: '团队详情' }))
  await waitFor(() => expect(b.view.container.querySelector('[data-team-detail-page]')).toBeTruthy())
  b.seedWorkspaceActivity(aggregate())
  return b
}

describe('Team Overview page', () => {
  it('updates the live strip on an activity change', async () => {
    const b = await openTeamDetail({ initialChannels: true })
    const strip = await waitFor(() => {
      const found = b.view.container.querySelector('[data-team-overview-strip]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    // The seeded roster is the bench's default: builder available, worker working.
    await waitFor(() => expect(strip.querySelector('[data-team-overview-agent="member:worker"]')).toBeTruthy())
    // A running Turn starts on the worker: the card flips to its live tool.
    b.publishActivity({ memberId: 'member:worker', handle: 'worker', threadRef: 'thread:1', current: { tool: 'Bash', label: 'running tests' } })
    await waitFor(() => {
      const live = strip.querySelector('[data-team-overview-agent="member:worker"] [data-live="true"]')
      expect(live?.textContent).toContain('running tests')
    })
    // And ends: the card falls back to its standing.
    b.endActivity('member:worker')
    await waitFor(() => expect(strip.querySelector('[data-team-overview-agent="member:worker"] [data-live="true"]')).toBeNull())
    await b.runtime.dispose()
  })

  it('lists a pending decision and a failed turn under needs attention', async () => {
    const b = await openTeamDetail({ initialChannels: true })
    b.seedDecisions([decisionView('thread:1')])
    const attention = await waitFor(() => {
      const found = b.view.container.querySelector('[data-team-overview-attention]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    const kinds = [...attention.querySelectorAll('[data-attention-kind]')].map(row => row.getAttribute('data-attention-kind'))
    expect(kinds).toContain('decision')
    expect(kinds).toContain('failure')
    // The failed turn names the stored reason; the decision names its context.
    expect(attention.textContent).toContain('provider refused to answer')
    expect(attention.textContent).toContain('Roll out now or wait for the freeze?')
    // The decision row opens its Thread through the shared navigation action: the
    // Overview face hands the column over to the Thread.
    fireEvent.click(attention.querySelector('[data-attention-kind="decision"]')!)
    await waitFor(() => expect(b.view.container.querySelector('[data-team-overview]')).toBeNull())
    await b.runtime.dispose()
  })

  it('pages the event feed through the cursor', async () => {
    // Page one holds two rows and names a cursor; the next page holds the older pair.
    const pages: Record<string, Record<string, unknown>> = {
      first: aggregate({ events: [eventRow(4), eventRow(3)], nextCursor: '3' }),
      rest: aggregate({ events: [eventRow(2), eventRow(1)] }),
    }
    const b = await openTeamDetail({ initialChannels: true })
    b.seedWorkspaceActivity(request => (request as { cursor?: string }).cursor === undefined ? pages.first! : pages.rest!)
    const feed = await b.view.findByTestId('overview-feed')
    await waitFor(() => expect(feed.querySelectorAll('[data-team-overview-event]')).toHaveLength(2))
    // The load-more control only stands while a cursor is held, so waiting for
    // it also waits out the mount-time refresh race before the click.
    fireEvent.click(await waitFor(() => b.view.getByRole('button', { name: '加载更多' })))
    // jsdom gives Virtuoso no measurable viewport, so only the initial items
    // render; the paged-in rows are read off the section's own count.
    const section = b.view.container.querySelector('[data-team-overview-feed]')!
    await waitFor(() => expect(section.getAttribute('data-event-count')).toBe('4'))
    // Newest first holds across what is rendered: page two's rows follow page one's.
    const sequences = [...feed.querySelectorAll('[data-team-overview-event]')].map(row => row.getAttribute('data-team-overview-event'))
    expect(sequences).toEqual(['4', '3'])
    await b.runtime.dispose()
  })

  it('opens the Overview inside the Team Detail page and keeps no Overview entry of its own', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    b.seedWorkspaceActivity(aggregate())
    // The Team browser no longer carries an Overview entry: the page has one
    // home, the Overview section of the Team Detail page.
    expect(b.view.queryByRole('button', { name: '总览' })).toBeNull()
    fireEvent.click(await b.view.findByRole('button', { name: '团队详情' }))
    // The Overview stands as the page's first section, over the Workspace the
    // Team navigation last selected.
    await waitFor(() => expect(b.view.container.querySelector('[data-team-overview]')).toBeTruthy())
    expect(b.view.container.querySelector('[data-team-detail-section="overview"]')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('renders the spend chart totals from the per-day buckets', async () => {
    const b = await openTeamDetail({ initialChannels: true })
    const spend = await waitFor(() => {
      const found = b.view.container.querySelector('[data-team-overview-spend]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    // The per-agent bars carry the day's totals per Member...
    const row = spend.querySelector('[data-team-overview-spend-agent="member:builder"]')
    expect(row?.textContent).toContain('140 tokens')
    // ...and the day chart draws one bar per bucketed day, named by its day.
    const days = spend.querySelector('[data-team-overview-spend-days]')
    expect(days?.querySelectorAll('[class*="dayBar"]').length).toBeGreaterThan(0)
    expect(spend.textContent).toContain('2026-09-13')
    await b.runtime.dispose()
  })

  it('shows an unproven spend bucket as unknown instead of a quiet zero', async () => {
    const unknown = aggregate({
      perDay: [{ day: '2026-09-13', tokensIn: null, tokensOut: 40, runMs: 1500, perAgent: [{ memberId: 'member:builder', tokensIn: null, tokensOut: 40, runMs: 1500 }] }],
    })
    const b = await openTeamDetail({ initialChannels: true })
    b.seedWorkspaceActivity(unknown)
    const spend = await waitFor(() => {
      const found = b.view.container.querySelector('[data-team-overview-spend]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    // The input side was never recorded, so the row states that instead of
    // summing an out-only number as if the day had been measured.
    const row = await waitFor(() => {
      const found = spend.querySelector('[data-team-overview-spend-agent="member:builder"]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    expect(row.getAttribute('data-unknown')).toBe('true')
    expect(row.textContent).toContain('输入用量未记录')
    // The day carries the same verdict, and a day with no bucket at all stays a
    // proven zero.
    const days = spend.querySelector('[data-team-overview-spend-days]')!
    const marked = days.querySelector('[data-unknown="true"]')
    expect(marked?.getAttribute('title')).toContain('2026-09-13')
    expect(days.querySelectorAll('[data-unknown="true"]').length).toBe(1)
    await b.runtime.dispose()
  })
})
