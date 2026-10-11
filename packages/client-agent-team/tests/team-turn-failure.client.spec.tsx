// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { AgentTeamMemberId, AgentTeamThreadRef, AgentTeamThreadTurnFailure } from '@contexera/dsh-agent-team/types'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const threadRef = 'thread:failure' as AgentTeamThreadRef
const failure = (sequence: number, turn: number, reason: string): AgentTeamThreadTurnFailure => ({
  sequence, occurredAt: '2026-08-21T09:30:00.000Z', threadRef, memberId: 'member:builder' as AgentTeamMemberId,
  handle: 'builder', sessionId: 'session:builder-1' as never, turn, reason,
})

/** Open the seeded Thread from its Channel, the way a Human reaches it. */
async function openThread(seedTurnFailures: readonly AgentTeamThreadTurnFailure[]) {
  const b = await runtimeWithTeam({
    mode: 'team', workspaceId: 'w1', initialChannels: true, seedThreadRef: threadRef,
    seededMessages: [
      { body: 'first question', occurredAt: '2026-08-21T09:00:00.000Z' },
      { body: 'second question', occurredAt: '2026-08-21T09:10:00.000Z' },
    ],
    seedTurnFailures,
  })
  fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
  // The seeded messages are Tasks: the Task link opens the Thread they share.
  fireEvent.click((await b.view.findAllByText('Task #1'))[0]!.closest('button')!)
  const page = await waitFor(() => {
    const node = b.view.container.querySelector('[data-team-thread]') as HTMLElement | null
    if (node === null) throw new Error('thread page not mounted')
    return node
  })
  return { b, page }
}

describe('Turn failure notices in the Thread (§6.0, human read path)', () => {
  it('renders each errored Turn as a row with the handle, the turn and the stored reason', async () => {
    const { page } = await openThread([failure(3, 1, 'Connection error.')])
    await waitFor(() => { expect(within(page).getByText('builder 的第 1 轮失败：Connection error.')).toBeTruthy() })
  })

  it('keeps existing Message order unchanged when a notice is present', async () => {
    const { page } = await openThread([failure(3, 1, 'Connection error.')])
    await waitFor(() => { expect(within(page).getByText('builder 的第 1 轮失败：Connection error.')).toBeTruthy() })
    const text = page.textContent ?? ''
    expect(text.indexOf('first question')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('first question')).toBeLessThan(text.indexOf('second question'))
    expect(text.indexOf('second question')).toBeLessThan(text.indexOf('builder 的第 1 轮失败'))
  })
})
