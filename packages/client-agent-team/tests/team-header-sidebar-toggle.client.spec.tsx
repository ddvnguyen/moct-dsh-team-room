// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

// One small suite per surface; the sidebar double rides the runtime's layout face.
vi.setConfig({ testTimeout: 30_000 })

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/**
 * L1 (issue 57, item 2): the shell's reopen control lives in the frame's
 * window-chrome seat and mounts only while the collapsed sidebar hides the
 * column entirely (macOS desktop). On any other platform the column keeps a
 * 56px rail, so the seat never mounts and a Channel/Thread reader with the
 * sidebar closed has no way back in. Both Team headers therefore carry their
 * own open-sidebar control while the shell column is collapsed.
 */
describe('Team header open-sidebar control', () => {
  it('shows the control on the Channel header only while the shell sidebar is collapsed', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    const header = b.view.container.querySelector('[data-team-slim-header="channel"]') as HTMLElement
    // Expanded: the column is open, so the header offers nothing.
    expect(within(header).queryByRole('button', { name: '打开侧边栏' })).toBeNull()

    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => expect(document.querySelector('[data-sidebar-collapsed]')).toBeTruthy())
    await waitFor(() => expect(within(header).getByRole('button', { name: '打开侧边栏' })).toBeTruthy())
    // The control opens the column again through the shell's own action.
    fireEvent.click(within(header).getByRole('button', { name: '打开侧边栏' }))
    await waitFor(() => expect(b.view.getByRole('button', { name: '工作区，Alpha' })).toBeTruthy())
    expect(within(header).queryByRole('button', { name: '打开侧边栏' })).toBeNull()
    await b.runtime.dispose()
  })

  it('leads the Channel header row rather than trailing inside its action group', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => expect(document.querySelector('[data-sidebar-collapsed]')).toBeTruthy())
    const header = b.view.container.querySelector('[data-team-slim-header="channel"]') as HTMLElement
    const back = (within(header).getByRole('button', { name: '返回频道列表' }) as HTMLElement).closest('span') as HTMLElement
    const reopen = within(header).getByRole('button', { name: '打开侧边栏' }) as HTMLElement
    // The reopen control follows the back control and precedes the title, so it
    // shares the row's leading edge instead of crowding the menu at the far right.
    expect(back.nextElementSibling).toBe(reopen)
    const title = header.querySelector('h1') as HTMLElement
    expect(reopen.nextElementSibling).toBe(title)
    await b.runtime.dispose()
  })
  it('shows the control on the Thread header only while the shell sidebar is collapsed', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    const header = await waitFor(() => b.view.container.querySelector('[data-team-slim-header="thread"]') as HTMLElement)
    expect(header).toBeTruthy()
    expect(within(header).queryByRole('button', { name: '打开侧边栏' })).toBeNull()

    fireEvent.click(b.view.getByRole('button', { name: 'Toggle fixture sidebar' }))
    await waitFor(() => expect(document.querySelector('[data-sidebar-collapsed]')).toBeTruthy())
    fireEvent.click(within(header).getByRole('button', { name: '打开侧边栏' }))
    await waitFor(() => expect(b.view.getByRole('button', { name: '工作区，Alpha' })).toBeTruthy())
    await b.runtime.dispose()
  })
})
