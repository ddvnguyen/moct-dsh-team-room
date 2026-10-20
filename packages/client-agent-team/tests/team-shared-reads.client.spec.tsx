// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

type Runtime = Awaited<ReturnType<typeof runtimeWithTeam>>

/**
 * Drive every continuation a resolved response queues — its landing, the guard
 * it runs through, the reads those issue — to quiescence. Each of them is a
 * microtask, so draining the microtask queue puts the test at a known point; a
 * wall-clock wait cannot, because a loaded machine ends it earlier and an update
 * that was still coming then reads as one that never happened.
 */
const drainContinuations = async (): Promise<void> => {
  for (let turn = 0; turn < 64; turn += 1) await Promise.resolve()
}

/** Let every mount-time read and stream baseline settle before scripting. */
const settleReads = (): Promise<void> => drainContinuations()

/**
 * Override the roster read with a scripted sequence of deferred answers,
 * indexed by issuance order (0-based from this point).
 */
function scriptReads(b: Runtime, answers: ReadonlyArray<Promise<unknown>>): () => number {
  let issued = 0
  ;(b.members as unknown as { mockImplementation(fn: () => Promise<unknown>): void }).mockImplementation(async () => {
    const index = issued
    issued += 1
    return await answers[Math.min(index, answers.length - 1)]!
  })
  return () => issued
}

/** The sidebar renders each Agent as one draggable row. */
const rosterTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[draggable="true"]')].map(node => (node.textContent ?? '').trim())

/**
 * The Channels panel's view answer with only the channel name swapped out;
 * every other field keeps the harness default shape so the panel's other
 * consumers stay intact.
 */
function viewPayload(name: string): { ok: true; value: Record<string, unknown> } {
  return {
    ok: true,
    value: {
      humanMemberId: 'member:human',
      channels: [{ channelRef: 'channel:engineering', workspaceId: 'w1', name, description: '', createdAtSequence: 1 }],
      members: [], tasks: [], threads: [], taskNumbers: [], items: [], claims: [], activities: [], cursor: 0, hasMore: false,
    },
  }
}

describe('shared client reads (issue 03)', () => {
  it('D5: a late-arriving stale view response never replaces the newer channels rows', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await b.view.findByText('# engineering')
    await settleReads()

    const held = Promise.withResolvers<unknown>()
    let issued = 0
    ;(b.viewChannels as unknown as { mockImplementation(fn: (request?: { includeCatalog?: boolean }) => Promise<unknown>): void }).mockImplementation(async (request) => {
      // The Agents list reads the board catalog through the same remote. That
      // read is a catalog, not the Channels rows this guard is about, so it
      // does not take part in the issuance count.
      if (request?.includeCatalog === true) return viewPayload('catalog')
      issued += 1
      return issued === 1 ? await held.promise : viewPayload('fresh-channel')
    })

    // Two distinct workspace wakes with one landing read in between, so the
    // second wake issues its own view read instead of riding the first.
    b.publishWorkspaceUpdate()
    await waitFor(() => expect(issued).toBe(1))
    b.publishWorkspaceUpdate()
    await b.view.findByText('# fresh-channel')

    // The first read now lands late carrying the old rows: the panel must drop
    // it instead of painting it over the newer result. That guard is the only
    // outcome of this landing — nothing is rendered or counted either way — so
    // the deterministic point to assert from is the drained microtask queue the
    // guard runs on, while the exact issuance below pins what the two wakes
    // were allowed to cost.
    held.resolve(viewPayload('stale-channel'))
    await drainContinuations()

    expect(issued).toBe(2)
    expect(b.view.queryByText('# stale-channel')).toBeNull()
    expect(b.view.queryByText('# fresh-channel')).not.toBeNull()
    await b.runtime.dispose()
  })

})
