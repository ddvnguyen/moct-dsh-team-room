// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

vi.setConfig({ testTimeout: 30_000 })
usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/**
 * L1 (issue 57, item 4): the running-expert status line above the Thread
 * composer. A13 v2 already mounts TeamActivityLine on the Thread page, but the
 * issue reports it is not visible. The suspected cause is the roster the line
 * folds against: the Thread page narrows `members` to the Thread's participants,
 * so a seat whose running Turn was delivered for a Thread it does not appear in
 * never produces a row. These specs pin both halves of that contract.
 *
 * The composer's picked-agent chip is also `role="status"`, so this file reads
 * the line through its own `data-team-activity` hook rather than by role.
 */
describe('Team Thread activity line', () => {
  const lineNode = (): HTMLElement | null => document.querySelector('[data-team-activity]')
  const openThread = async (b: Awaited<ReturnType<typeof runtimeWithTeam>>) => {
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    await waitFor(() => expect(b.view.getByRole('textbox', { name: '消息内容' })).toBeTruthy())
  }

  it('shows the running Turn of a Thread participant above the Thread composer', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [{ memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' }],
      // builder is the Thread's participant: the opener @-names it.
      seededMessages: [{ body: 'thread opener @builder', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent', mentions: ['member:builder'] }],
    })
    await openThread(b)
    b.publishActivity({ memberId: 'member:builder', handle: '@builder', threadRef: 'thread:1', stepCount: 3, toolCount: 4, current: { tool: 'Read', label: 'Read server.ts' } })
    await waitFor(() => expect(lineNode()).not.toBeNull())
    const line = lineNode()!
    // The line is the Thread's own surface: it mounts inside the composer's
    // root, directly above the composer card, so it never moves the list.
    const composerRoot = screen.getByRole('textbox', { name: '消息内容' }).closest('form')!
    expect(composerRoot.contains(line)).toBe(true)
    expect(line.getAttribute('data-team-activity')).toBeTruthy()
    expect(line.textContent).toContain('@builder')
    expect(line.textContent).toContain('Read server.ts')
    expect(line.textContent).toContain('本 Thread')
    expect(line.textContent).toContain('第 3 步')
    expect(line.textContent).toContain('4 个工具')
    await b.runtime.dispose()
  })

  it('clears the line when the seat goes idle, and re-mounts it for the next Turn', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [{ memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' }],
      seededMessages: [{ body: 'thread opener @builder', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent', mentions: ['member:builder'] }],
    })
    await openThread(b)
    b.publishActivity({ memberId: 'member:builder', handle: '@builder', threadRef: 'thread:1' })
    await waitFor(() => expect(lineNode()?.textContent).toContain('@builder'))
    b.endActivity('member:builder')
    await waitFor(() => expect(lineNode()).toBeNull())
    b.publishActivity({ memberId: 'member:builder', handle: '@builder', threadRef: 'thread:1' })
    await waitFor(() => expect(lineNode()?.textContent).toContain('@builder'))
    await b.runtime.dispose()
  })

  it('drops the row of a running seat that is not a Thread participant', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' },
        { memberId: 'member:outsider', workspaceId: 'w1', handle: 'outsider' },
      ],
      // Only builder is a Thread participant: outsider joined the Channel but
      // the loaded Thread facts never name it.
      seedChannelMembers: [
        { channelRef: 'channel:engineering', memberId: 'member:builder' },
        { channelRef: 'channel:engineering', memberId: 'member:outsider' },
      ],
      seededMessages: [{ body: 'thread opener @builder', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent', mentions: ['member:builder'] }],
    })
    await openThread(b)
    b.publishActivity({ memberId: 'member:builder', handle: '@builder', threadRef: 'thread:1' })
    await waitFor(() => expect(lineNode()?.textContent).toContain('@builder'))
    // A Turn delivered for this Thread by a seat the Thread does not carry:
    // the Host feed reports it, and the page narrows the roster to the Thread's
    // participants, so no second row appears. This is the exact shape the
    // issue's suspected cause describes — if the line ever shows a seat the
    // Thread never names, that is a roster-scope leak, not a fix.
    b.publishActivity({ memberId: 'member:outsider', handle: '@outsider', threadRef: 'thread:1' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(lineNode()?.textContent).not.toContain('@outsider')
    expect(lineNode()?.textContent).toContain('@builder')
    await b.runtime.dispose()
  })

  it('stays empty while the feed reports no Turn, even after a presence wake', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [{ memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' }],
      seededMessages: [{ body: 'thread opener @builder', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent', mentions: ['member:builder'] }],
    })
    await openThread(b)
    // A presence wake alone must not fabricate a row: the line reads the Host's
    // running-Turn feed, which reports a seat only once its Turn is folded.
    b.publishPresence()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(lineNode()).toBeNull()
    await b.runtime.dispose()
  })
})
