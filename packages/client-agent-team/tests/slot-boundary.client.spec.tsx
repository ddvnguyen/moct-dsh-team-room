// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Mounting the Team runtime in jsdom is slow on the windows lane; keep headroom.
vi.setConfig({ testTimeout: 30_000 })
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

/** Flipped per test: while on, the named Team component throws on every render. */
const crash = vi.hoisted(() => ({ conversation: false, browser: false }))

vi.mock('../src/client/TeamConversation.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/TeamConversation.tsx')>()
  return {
    ...actual,
    TeamConversation: (props: Parameters<typeof actual.TeamConversation>[0]) => {
      if (crash.conversation) throw new Error('conversation render failed')
      return <actual.TeamConversation {...props} />
    },
  }
})

vi.mock('../src/client/TeamWorkspaceBrowser.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/TeamWorkspaceBrowser.tsx')>()
  return {
    ...actual,
    TeamWorkspaceBrowser: (props: Parameters<typeof actual.TeamWorkspaceBrowser>[0]) => {
      if (crash.browser) throw new Error('browser render failed')
      return <actual.TeamWorkspaceBrowser {...props} />
    },
  }
})

/** jsdom reports an uncaught render error as a window error event; the boundary has caught it. */
const swallow = (event: ErrorEvent): void => { event.preventDefault() }

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  crash.conversation = false
  crash.browser = false
  // React reports a contained render error through console.error; the boundary
  // under test is the thing being exercised, so keep the log readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.addEventListener('error', swallow)
})
afterEach(() => {
  window.removeEventListener('error', swallow)
  vi.restoreAllMocks()
})

/**
 * A Team slot that throws must not take its surroundings with it. The host's own
 * boundary leaves an empty `data-slot-error` and, for a single-winner slot,
 * retires the entry; the Team's boundary keeps the entry, says so, and lets the
 * Human retry.
 */
describe('Team slot boundary', () => {
  it('shows an alert with Retry for a conversation that throws, keeps siblings mounted, and recovers on Retry', async () => {
    crash.conversation = true
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await act(async () => { b.selectPanel('agent-team') })

    const alert = await b.view.findByRole('alert')
    expect(alert.getAttribute('data-team-slot-error')).toBe('main:team')
    expect(alert.textContent).toContain('这一块没能显示出来。')
    // The host's own boundary never fired: this alert is the Team's.
    expect(b.view.container.querySelector('[data-slot-error]')).toBeNull()
    // Sibling slots stay mounted: the rail rows are other registrations.
    expect(b.view.getByRole('button', { name: '团队设置' })).toBeTruthy()
    expect(b.view.getByRole('button', { name: '团队' })).toBeTruthy()

    // Retry while the cause persists fails again, visibly, without losing the alert.
    fireEvent.click(b.view.getByRole('button', { name: '重试' }))
    expect(await b.view.findByRole('alert')).toBeTruthy()

    crash.conversation = false
    fireEvent.click(b.view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(b.view.queryByRole('alert')).toBeNull())
    expect(await b.view.findByRole('button', { name: '# engineering' })).toBeTruthy()
  })

  it('contains a crash in the native tab body inside the tab and recovers on Retry', async () => {
    crash.browser = true
    const b = await runtimeWithTeam({ nativeTabs: true })

    const tab = await waitFor(() => {
      const found = b.view.container.querySelector('[data-native-tab]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    const alert = await waitFor(() => {
      const found = tab.querySelector('[role="alert"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(alert.getAttribute('data-team-slot-error')).toBe('native-tab')
    // The strip itself, which is the host's, is still standing around the tab.
    expect(b.view.container.querySelector('[data-baseline-workspaces]')).not.toBeNull()

    crash.browser = false
    fireEvent.click(b.view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(tab.querySelector('[role="alert"]')).toBeNull())
  })
})
