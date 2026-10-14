// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Stands in for the shipped plugin manager's global panel (main key 'plugins'). */
function ShippedPluginPage() { return <div data-shipped-plugins>插件</div> }

/**
 * The shell renders one keyed main panel — `activePanelId ?? 'conversation'` —
 * and the Team is one of those panels: the sidebar rail's Team row selects it and
 * the mode follows the selection. A global panel the Human selected owns the
 * column until that row takes it back, and a restored Team mode yields to a panel
 * that was already selected when the page loaded.
 */
describe('Team mode and the shell main panel', () => {
  it('yields a restored Team mode to a global panel already selected at mount', async () => {
    const b = await runtimeWithTeam({ mode: 'team', mainPanelId: 'plugins', workspaceId: 'w1' })
    // The panel owns the column, so the restored mode stands down rather than
    // covering the page the reader left open.
    await waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('conversation'))
    expect(b.panelInfo.getSnapshot().activePanelId).toBe('plugins')
  })

  it('takes the column back from a global panel when the Team tab picks a Channel', async () => {
    const b = await runtimeWithTeam({ workspaceId: 'w1', initialChannels: true })
    b.runtime.slots.register({ name: 'main', key: 'plugins' }, ShippedPluginPage as never)
    await act(async () => { b.selectPanel('plugins') })
    expect(await b.view.findByText('插件')).toBeTruthy()

    // The pick is the Team's request for the column: the panel lets go of it
    // and the mode follows. No Team panel is selected on the way.
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    await waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team'))
    expect(b.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(b.view.container.querySelector('[data-shipped-plugins]')).toBeNull()
  })

  it('opens a Channel from the tab with one sidebar: no Team panel selected, no Team section mounted', async () => {
    const b = await runtimeWithTeam({ workspaceId: 'w1', initialChannels: true })
    const sidebarBefore = b.view.container.querySelectorAll('[data-slot="sidebar"]').length

    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))

    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    expect(b.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team')
    // The shell's strip is still the only browsing surface: the Team tab stays
    // in it, and no `sidebar.sections` occupant or second sidebar appears.
    expect(b.runtime.slots.entries('sidebar.sections' as never)).toHaveLength(0)
    expect(b.view.container.querySelectorAll('[data-slot="sidebar"]').length).toBe(sidebarBefore)
    expect(b.view.container.querySelector('[data-native-tab="team"]')).not.toBeNull()
    expect(b.view.container.querySelector('[data-baseline-workspaces]')).not.toBeNull()
  })

  it('renders only the Channel list in the Team tab: no Inbox card, no Workspace picker, no Agents', async () => {
    const b = await runtimeWithTeam({ workspaceId: 'w1', initialChannels: true })
    const tab = await waitFor(() => {
      const found = b.view.container.querySelector('[data-native-tab="team"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    expect(await within(tab).findByRole('button', { name: '# engineering' })).toBeTruthy()
    // The Channels list keeps its create action.
    expect(within(tab).getByRole('button', { name: '新建频道' })).toBeTruthy()
    // The Inbox card and the Workspace picker are the fuller browser's.
    expect(within(tab).queryByRole('button', { name: /^收件箱/ })).toBeNull()
    expect(tab.querySelector('[data-team-workspace-trigger]')).toBeNull()
    expect(within(tab).queryByRole('button', { name: /^工作区/ })).toBeNull()
    expect(within(tab).queryByRole('button', { name: '添加 Agent' })).toBeNull()
  })

  it('opens Team Settings from its rail row, then a Channel pick from the tab returns to the Team page', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    expect(await b.view.findByRole('button', { name: '# engineering' })).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: '团队设置' }))

    await waitFor(() => expect(b.panelInfo.getSnapshot().activePanelId).toBe('agent-team-settings'))
    const page = await waitFor(() => {
      const found = b.view.container.querySelector('[data-team-settings-page]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(page.querySelector('h2')?.textContent).toBe('团队设置')
    // The Agents config is on the page; the Team mode it was opened from stays.
    expect(await within(page).findByRole('button', { name: '添加 Agent' })).toBeTruthy()
    expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team')

    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))
    await waitFor(() => expect(b.view.container.querySelector('[data-team-settings-page]')).toBeNull())
    expect(b.panelInfo.getSnapshot().activePanelId).toBeNull()
  })

  it('opens the picked Channel when the native Team tab picks it from a plain conversation', async () => {
    // The Workspace selection starts unset here (a fresh load): the pick enters
    // Team mode, the browser remounts in the section, and its default-Workspace
    // adoption must not discard the Channel the click just chose.
    const b = await runtimeWithTeam({ nativeTabs: true, workspaceId: 'w1', initialChannels: true })
    expect(b.runtime.ctx.teamNavigation.getSnapshot()).toEqual({ mode: 'conversation' })
    const tab = await waitFor(() => {
      const found = b.view.container.querySelector('[data-native-tab="team"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    fireEvent.click(await within(tab).findByRole('button', { name: '# engineering' }))

    await waitFor(() => expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team'))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    expect(b.runtime.ctx.teamNavigation.getSnapshot().channelRef).toBeDefined()
    expect(b.view.container.querySelector('[data-team-channel]')).not.toBeNull()
    expect(b.view.queryByRole('textbox', { name: '消息内容' })).not.toBeNull()
  })
})
