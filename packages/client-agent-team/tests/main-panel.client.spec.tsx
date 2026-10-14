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

  it('takes the column back from a global panel when the rail row selects the Team', async () => {
    const b = await runtimeWithTeam({})
    b.runtime.slots.register({ name: 'main', key: 'plugins' }, ShippedPluginPage as never)
    await act(async () => { b.selectPanel('plugins') })
    expect(await b.view.findByText('插件')).toBeTruthy()

    // The rail row is the shell's own button: it selects the panel, and the mode
    // is what follows.
    fireEvent.click(b.view.getByRole('button', { name: '团队' }))

    await waitFor(() => expect(b.panelInfo.getSnapshot().activePanelId).toBe('agent-team'))
    expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team')
    expect(b.view.container.querySelector('[data-shipped-plugins]')).toBeNull()
  })

  it('keeps the Team panel selected while the mode navigates inside itself', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await act(async () => { b.selectPanel('agent-team') })
    // The Team's own overview stands in the column while the panel is selected.
    expect(await b.view.findByRole('button', { name: '# engineering' })).toBeTruthy()

    fireEvent.click(b.view.getByRole('button', { name: '# engineering' }))

    // A Team destination is not a panel: the rail keeps saying which destination
    // the column belongs to while the Team's own pages move underneath it.
    await waitFor(() => expect(b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy())
    expect(b.panelInfo.getSnapshot().activePanelId).toBe('agent-team')
    expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('team')
  })

  it('opens Team Settings from its rail row with the Agents config, then a Channel pick returns to the Team page', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    await act(async () => { b.selectPanel('agent-team') })
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
    await waitFor(() => expect(b.panelInfo.getSnapshot().activePanelId).toBe('agent-team'))
    expect(b.view.container.querySelector('[data-team-settings-page]')).toBeNull()
  })

  it('shows the Inbox page when the native Team tab picks the Inbox from a plain conversation', async () => {
    const b = await runtimeWithTeam({ nativeTabs: true, workspaceId: 'w1' })
    expect(b.runtime.ctx.teamNavigation.getSnapshot().mode).toBe('conversation')
    const tab = await waitFor(() => {
      const found = b.view.container.querySelector('[data-native-tab="team"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    // TEST-6: the card took the current-page mark while the column stayed on the
    // conversation, because the tab only moved the Team navigation.
    fireEvent.click(await within(tab).findByRole('button', { name: /^收件箱/ }))

    await waitFor(() => expect(b.panelInfo.getSnapshot().activePanelId).toBe('agent-team'))
    expect(b.runtime.ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', inbox: true })
    expect(await b.view.findByRole('heading', { level: 1, name: '收件箱' })).toBeTruthy()
    expect(b.view.container.querySelector('[data-team-inbox]')).not.toBeNull()
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
