// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

vi.setConfig({ testTimeout: 30_000 })
usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/**
 * L1 (issue 57, item 3): the Thread member surface. The Host's changeAttention is
 * the Human's PERSONAL op — the request carries no memberId and the Host binds the
 * actor — so the surface it can honestly offer is: read the members and followers,
 * toggle the reading Human's own follow, and invite a Channel member by seeding an
 * @mention into the composer (sending it is the invitation). Adding or removing
 * another seat is a NEW op kind and out of scope.
 */
describe('Team Thread member surface', () => {
  const openThread = async (b: Awaited<ReturnType<typeof runtimeWithTeam>>) => {
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    await waitFor(() => expect(b.view.getByRole('textbox', { name: '消息内容' })).toBeTruthy())
  }

  it('lists Thread participants and offers the Human an unfollow control while they follow', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' },
        { memberId: 'member:reviewer', workspaceId: 'w1', handle: 'reviewer' },
      ],
      seedChannelMembers: [
        { channelRef: 'channel:engineering', memberId: 'member:builder' },
        { channelRef: 'channel:engineering', memberId: 'member:reviewer' },
      ],
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openThread(b)
    fireEvent.click(b.view.getByRole('button', { name: 'Thread 成员' }))
    const dialog = await screen.findByRole('dialog')
    // The roster is the Thread participants (here builder alone), so reviewer —
    // a Channel member the Thread never named — is not in the dialog at all.
    expect(within(dialog).getByText('@builder')).toBeTruthy()
    expect(within(dialog).queryByText('@reviewer')).toBeNull()
    // The Human is a participant without a Message, so they get the follow row:
    // seeded as a follower, so the control unfollows.
    expect(within(dialog).getByRole('button', { name: '取消关注' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '关注此 Thread' })).toBeNull()
    await b.runtime.dispose()
  })

  it('toggles the Human\'s own follow through the shared changeAttention remote', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [{ memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' }],
      seedChannelMembers: [{ channelRef: 'channel:engineering', memberId: 'member:builder' }],
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
      // Start unfollowed so the first committed op is a follow.
      seedFollowers: [],
    })
    await openThread(b)
    fireEvent.click(b.view.getByRole('button', { name: 'Thread 成员' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '关注此 Thread' }))
    await waitFor(() => expect(b.changeAttention).toHaveBeenCalled())
    // The request names no memberId: the Host binds the actor, so this can only
    // ever be the reading Human's own follow.
    const request = b.changeAttention.mock.calls[0]![0] as { action: string; memberId?: string }
    expect(request.action).toBe('follow')
    expect(request.memberId).toBeUndefined()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消关注' })).toBeTruthy())
    // Unfollow round-trips back through the same remote.
    fireEvent.click(within(dialog).getByRole('button', { name: '取消关注' }))
    await waitFor(() => expect((b.changeAttention.mock.calls.at(-1)![0] as { action: string }).action).toBe('unfollow'))
    dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '关注此 Thread' })).toBeTruthy())
    await b.runtime.dispose()
  })

  it('invites a Channel member by seeding an @mention into the composer draft', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' },
        { memberId: 'member:reviewer', workspaceId: 'w1', handle: 'reviewer' },
      ],
      seedChannelMembers: [
        { channelRef: 'channel:engineering', memberId: 'member:builder' },
        { channelRef: 'channel:engineering', memberId: 'member:reviewer' },
      ],
      // The reviewer is named by the Thread without posting, so the roster carries
      // them and the dialog can invite them by mention.
      seededMessages: [{ body: 'thread opener cc @reviewer', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent', mentions: ['member:reviewer'] }],
    })
    await openThread(b)
    fireEvent.click(b.view.getByRole('button', { name: 'Thread 成员' }))
    const dialog = await screen.findByRole('dialog')
    // builder already speaks in the Thread; reviewer is named by it. Both are
    // Channel members, so both carry the invite row.
    const inviteRows = within(dialog).getAllByRole('button', { name: '邀请加入讨论' })
    expect(inviteRows).toHaveLength(2)
    const reviewerRow = within(dialog).getByText('@reviewer').closest('[data-team-member-row]') as HTMLElement
    fireEvent.click(reviewerRow.querySelector('button')!)
    // The composer holds @reviewer: sending it is the invitation, through the
    // existing mention path — no new op, no membership mutation.
    await waitFor(() => expect((b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement).value).toContain('@reviewer'))
    await b.runtime.dispose()
  })
})
