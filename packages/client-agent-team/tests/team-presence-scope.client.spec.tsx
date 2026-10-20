// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('presence-scope wake wiring (issue #21)', () => {
  it('presence wake on an open Thread refreshes only the roster, never the view', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: '开工任务', occurredAt: '2026-08-21T09:00:00.000Z' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click(await b.view.findByRole('button', { name: '打开 Task #1' }))
    await b.view.findByRole('heading', { name: 'Task #1' })
    await new Promise(resolve => setTimeout(resolve, 300))
    // The bench mounts the Team's seats and the strip's tab bodies at once, so
    // a read count settles a moment after the Thread opens. The test measures
    // what the presence wake adds, so the baseline has to be a settled one.
    const settled = async (count: () => number): Promise<number> => {
      let previous = count()
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const current = count()
        if (current === previous) return current
        previous = current
      }
      return previous
    }
    const inboxCalls = await settled(() => b.inbox.mock.calls.length)
    const channelCalls = await settled(() => b.viewChannels.mock.calls.length)
    const memberCalls = await settled(() => b.members.mock.calls.length)

    // A presence wake moves member rows only (issue 03, criterion 4): the
    // open Thread's roster refresh must not ride the supplemental view
    // fetch, so view() stays parked exactly like the Inbox badge. The badge
    // debounces, so wait past that window before asserting stillness.
    b.publishPresence()
    await waitFor(() => expect(b.members.mock.calls.length).toBeGreaterThan(memberCalls))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(b.viewChannels.mock.calls.length).toBe(channelCalls)
    expect(b.inbox.mock.calls.length).toBe(inboxCalls)
    await b.runtime.dispose()
  })
})
