// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// One slim row replaces the old back-row + header stack on both conversation
// pages; the suite keeps headroom like the conversation suite does.
vi.setConfig({ testTimeout: 30_000 })
import { cleanup, fireEvent, within, type RenderResult } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Pick one workspace member in the create-channel member menu, reopening it when a pick closes it. */
async function pickChannelMember(view: RenderResult, pattern: RegExp): Promise<void> {
  let item = within(document.body).queryByRole('menuitem', { name: pattern })
  if (item === null) {
    fireEvent.click(view.getByRole('button', { name: /初始成员/ }))
    item = await within(document.body).findByRole('menuitem', { name: pattern })
  }
  fireEvent.click(item)
}

describe('D1 slim conversation header', () => {
  it('renders the Channel header as one slim row: back, title, seats, counts, overflow', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1' })
    fireEvent.click(await b.view.findByRole('button', { name: '新建频道' }))
    fireEvent.change(b.view.getByLabelText('名称'), { target: { value: 'backend' } })
    fireEvent.change(b.view.getByLabelText(/说明/), { target: { value: 'API and workers' } })
    // The picker offers joinable seats: the unavailable member is not among them.
    await pickChannelMember(b.view, /builder/)
    await pickChannelMember(b.view, /worker/)
    await pickChannelMember(b.view, /failed/)
    fireEvent.click(b.view.getByRole('button', { name: '创建频道' }))
    fireEvent.click(await b.view.findByRole('button', { name: '# backend' }))
    expect(await b.view.findByRole('heading', { name: '# backend' })).toBeTruthy()

    const channelPage = b.view.container.querySelector('[data-team-channel]') as HTMLElement
    const headers = channelPage.querySelectorAll('[data-team-slim-header]')
    expect(headers.length).toBe(1)
    const header = headers[0] as HTMLElement
    expect(header.getAttribute('data-team-slim-header')).toBe('channel')
    // The old back row is gone: the icon-only back button is the row's first element.
    const back = within(header).getByRole('button', { name: '返回频道列表' })
    expect(back.textContent?.trim()).toBe('')
    expect(header.firstElementChild?.contains(back)).toBe(true)
    // The description keeps its full text as a tooltip while the row compresses it.
    const desc = within(header).getByText('API and workers')
    expect(desc.getAttribute('title')).toBe('API and workers')
    // Three seats fit the five-chip cap, so every seat shows and no +N follows.
    const chips = [...header.querySelectorAll('[class*="slimChipName"]')]
    expect(chips.map(chip => chip.textContent).sort()).toEqual(['builder', 'failed', 'worker'])
    expect(header.querySelector('[class*="slimOverflowCount"]')).toBeNull()
    // Only the working seat counts as working; the feed is empty and nothing is unread.
    expect(within(header).getByText('1 位工作中')).toBeTruthy()
    expect(within(header).getByText('0 个 Thread')).toBeTruthy()
    expect(within(header).getByText('0 条未读')).toBeTruthy()
    // Channel membership is derived from Thread participation, so the
    // overflow menu offers Archive and no Manage members entry.
    const menuButton = within(header).getByRole('button', { name: '频道操作' })
    fireEvent.click(menuButton)
    const menuItems = await within(document.body).findAllByRole('menuitem')
    expect(menuItems.map(item => item.textContent?.trim())).toEqual(['归档频道'])
  })

  it('renders the Thread header as one slim row: crumb, participants, status, actions', async () => {
    const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', initialChannels: true })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    expect(await b.view.findByRole('heading', { name: '# engineering' })).toBeTruthy()
    fireEvent.change(b.view.getByRole('textbox', { name: '消息内容' }), { target: { value: 'thread opener' } })
    fireEvent.click(b.view.getByRole('button', { name: '作为任务' }))
    fireEvent.click(b.view.getByRole('button', { name: '发送' }))
    fireEvent.click(await b.view.findByRole('button', { name: '打开 Task #1' }))
    expect(await b.view.findByText('# engineering / Task #1')).toBeTruthy()

    const threadPage = b.view.container.querySelector('[data-team-thread]') as HTMLElement
    const headers = threadPage.querySelectorAll('[data-team-slim-header]')
    expect(headers.length).toBe(1)
    const header = headers[0] as HTMLElement
    expect(header.getAttribute('data-team-slim-header')).toBe('thread')
    // "Back to Channel" is the row's own first visible element, carrying the
    // crumb. The page heading keeps the short Task name for assistive
    // technology in a spaceless h1 ahead of it.
    // The crumb keeps the Task number every entry row references; the titled
    // Task's own title rides the tooltip.
    expect(within(header).getByRole('heading', { name: 'Task #1' })).toBeTruthy()
    const crumb = within(header).getByRole('button', { name: '返回频道' })
    expect(crumb.previousElementSibling?.tagName).toBe('H1')
    expect(crumb.textContent).toContain('# engineering / Task #1')
    expect(crumb.getAttribute('title')).toContain('thread opener')
    // The Human holds the only Message, so the participant stack names them.
    const stack = within(header).getByRole('img')
    expect(stack.getAttribute('aria-label')).toContain('human')
    // A todo Task keeps its status pill and its accept + close actions on the row.
    expect(within(header).getByText('待处理')).toBeTruthy()
    expect(within(header).getByRole('button', { name: '验收' })).toBeTruthy()
    expect(within(header).getByRole('button', { name: '关闭任务' })).toBeTruthy()
  })
})
