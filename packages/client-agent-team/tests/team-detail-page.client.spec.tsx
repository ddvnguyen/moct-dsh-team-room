// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'
import { TeamDetailPage, type TeamDetailPageProps } from '../src/client/TeamDetailPage.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Open the Team Detail page from the side menu's row, the way a reader does. */
async function openTeamDetail(seed?: Parameters<typeof runtimeWithTeam>[0]) {
  const b = await runtimeWithTeam({ mode: 'team', workspaceId: 'w1', ...seed })
  fireEvent.click(await b.view.findByRole('button', { name: '团队详情' }))
  const page = await waitFor(() => {
    const found = b.view.container.querySelector('[data-team-detail-page]')
    expect(found).not.toBeNull()
    return found as HTMLElement
  })
  return { b, page }
}

describe('Team Detail page', () => {
  it('preserves the host workspace-list receiver when subscribing', () => {
    const snapshot = { items: [] as const }
    const store = {
      listeners: new Set<() => void>(),
      getSnapshot() { return snapshot },
      subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
    }
    const identity = { name: 'Human' }
    const props = {
      workspaceList: store,
      initialWorkspaceId: () => undefined,
      humanIdentity: { getSnapshot: () => identity, subscribe: () => () => {} },
      t: (key: string) => key,
    } as unknown as TeamDetailPageProps

    const view = render(<TeamDetailPage {...props} />)

    expect(store.listeners.size).toBe(1)
    view.unmount()
    expect(store.listeners.size).toBe(0)
  })

  it('opens on the Overview and switches between the four sections', async () => {
    const { b, page } = await openTeamDetail()
    // The four sections, in reading order.
    expect(within(page).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['总览', 'Agents', '团队记忆', '设置'])
    // The Overview is the page's first section: the workspace Overview answers
    // "what is going on now and today".
    expect(page.querySelector('[data-team-detail-section="overview"]')).not.toBeNull()
    await waitFor(() => expect(page.querySelector('[data-team-overview]')).not.toBeNull())

    fireEvent.click(within(page).getByRole('tab', { name: 'Agents' }))
    expect(page.querySelector('[data-team-detail-section="agents"]')).not.toBeNull()
    expect(within(page).getByRole('button', { name: '添加 Agent' })).toBeTruthy()

    fireEvent.click(within(page).getByRole('tab', { name: '团队记忆' }))
    expect(page.querySelector('[data-team-detail-section="memory"]')).not.toBeNull()
    await waitFor(() => expect(page.querySelector('[data-team-memory]')).not.toBeNull())

    fireEvent.click(within(page).getByRole('tab', { name: '设置' }))
    expect(page.querySelector('[data-team-detail-section="settings"]')).not.toBeNull()
    // One section at a time: the Overview is gone while Settings stands.
    expect(page.querySelector('[data-team-overview]')).toBeNull()
    await b.runtime.dispose()
  })

  it('reads every section under the one Workspace the header picked', async () => {
    const { b, page } = await openTeamDetail()
    await waitFor(() => expect(b.workspaceActivity).toHaveBeenCalled())
    expect(b.workspaceActivity.mock.calls[0]?.[0]).toMatchObject({ workspaceId: 'w1' })

    // Another Workspace picked in the header scopes every section, the Overview
    // among them: one scope, not one per section.
    fireEvent.click(page.querySelector('[data-team-workspace-trigger]')!)
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Beta')
      expect(found).toBeTruthy()
      return found!
    })
    fireEvent.click(entry)
    await waitFor(() => expect(b.workspaceActivity.mock.calls.some(call => call[0].workspaceId === 'w2')).toBe(true))
    await b.runtime.dispose()
  })
})
