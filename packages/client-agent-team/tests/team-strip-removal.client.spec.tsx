// @vitest-environment jsdom
//
// task-11 — the legacy Team tab is gone from the strip: "merging the second
// sidebar into the Team tab" left ONE native sidebar. The Team entry is the
// rail row plus the additive `sidebar.sections` seat; the `Tasks | Team |
// Scheduled` strip keeps only `Tasks` and `Scheduled`.
//
// Pinned from the two surfaces the reader sees: the strip must render no Team
// tab beside Tasks/Scheduled, and nothing may register a second channel list
// into the shipped `sidebar.workspaces` browser. The insert path the legacy
// code used (slot subscription + 20 × 250 ms retries) gets its full shot
// before the verdict — absence has to survive every probe, not the first.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('the strip carries no legacy Team tab', () => {
  it('renders the strip without a Team tab and adds no second sidebar.workspaces list', async () => {
    const bench = await runtimeWithTeam({ nativeTabs: true })

    // The legacy insert found the harness strip's own `__dshNativeTabs`
    // registry through the owner's two-step discovery and inserted on the slot
    // subscription; the retry budget (20 × 250 ms) also had its full shot.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 700)) })

    // The strip itself still stands (baseline workspace seat rendering) …
    expect(bench.view.container.querySelector('[data-baseline-workspaces]')).not.toBeNull()
    // … but no Team tab was ever inserted into it.
    expect(bench.view.container.querySelector('[data-native-tab="team"]')).toBeNull()
    // One browser, one channel list: the Team keeps the additive
    // `sidebar.sections` seat instead of occupying the shipped browser twice.
    expect(bench.runtime.slots.entriesOfSlot('sidebar.workspaces')).toHaveLength(1)
  })
})
