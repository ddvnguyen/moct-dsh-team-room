// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { runtimeWithTeam } from './harness.tsx'

// One small suite; it waits on Thread reads, so it keeps headroom.
vi.setConfig({ testTimeout: 30_000 })

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/**
 * L1 (issue 57): the Thread composer's roster leaked every Workspace seat when
 * the Channel had no joined Member, because the Thread filter's `size === 0`
 * escape passed the whole roster through unfiltered — archived seats included.
 * The roster is now the Thread's participants, falling back to the Channel's
 * enabled members.
 */
describe('Team Thread roster', () => {
  /** Open the seeded Channel, then the first Task footer's Thread page. */
  const openThread = async (b: Awaited<ReturnType<typeof runtimeWithTeam>>) => {
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    await waitFor(() => expect(b.view.getByRole('textbox', { name: '消息内容' })).toBeTruthy())
  }

  const openPicker = async () => {
    fireEvent.click(screen.getByRole('button', { name: '选择 Agent' }))
    return screen.getAllByRole('option').map(option => (option.textContent ?? '').trim())
  }

  it('lists only the Thread participants in the picker and the mention candidates', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' },
        { memberId: 'member:worker', workspaceId: 'w1', handle: 'worker' },
        { memberId: 'member:failed', workspaceId: 'w1', handle: 'failed', presence: 'error', diagnostic: { class: 'runtime', detail: 'model failed' } },
        { memberId: 'member:offline', workspaceId: 'w1', handle: 'offline', presence: 'unavailable', diagnostic: { class: 'preset-composition', detail: 'preset missing' } },
      ],
      seedChannelMembers: [],
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openThread(b)

    // The picker carries the Thread's one participant and nothing else: no
    // Channel membership exists for this Channel, which is the case that used
    // to fall open to every Workspace seat.
    const options = await openPicker()
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('@builder')
    expect(options.join('|')).not.toContain('@worker')
    expect(options.join('|')).not.toContain('@failed')
    expect(options.join('|')).not.toContain('@offline')

    // The mention candidates read the same roster, so the leak dies in one change.
    const input = b.view.getByRole('textbox', { name: '消息内容' }) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'thread opener @' } })
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
    const mentions = screen.getAllByRole('option').map(option => option.textContent ?? '')
    expect(mentions.join('|')).toContain('@builder')
    expect(mentions.join('|')).not.toContain('@worker')
    expect(mentions.join('|')).not.toContain('@failed')
    expect(mentions.join('|')).not.toContain('@offline')
    fireEvent.click(document.body)
    await b.runtime.dispose()
  })

  it('lists no seat that is neither a Thread participant nor an enabled Channel member', async () => {
    // The two cases above combined: this roster mixes a Thread participant, a
    // Workspace member outside the Thread, and an archived Channel member.
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:builder', workspaceId: 'w1', handle: 'builder' },
        { memberId: 'member:worker', workspaceId: 'w1', handle: 'worker' },
        { memberId: 'member:gone-archived', workspaceId: 'w1', handle: 'gone-archived', state: 'archived' },
      ],
      seedChannelMembers: [
        { channelRef: 'channel:engineering', memberId: 'member:builder' },
        { channelRef: 'channel:engineering', memberId: 'member:worker' },
        { channelRef: 'channel:engineering', memberId: 'member:gone-archived' },
      ],
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openThread(b)
    const options = await openPicker()
    // The participant only: worker is a Channel member the Thread never named,
    // and the archived seat is both. The escape that listed the whole Workspace
    // cannot come back without this failing.
    expect(options).toHaveLength(1)
    expect(options[0]).toContain('@builder')
    expect(options.join('|')).not.toContain('@worker')
    expect(options.join('|')).not.toContain('@gone-archived')
    await b.runtime.dispose()
  })

  it('falls back to the Channel members minus archived and inactive when the projection has no Thread facts', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedRoster: [
        { memberId: 'member:joined-a', workspaceId: 'w1', handle: 'joined-a' },
        { memberId: 'member:joined-b', workspaceId: 'w1', handle: 'joined-b' },
        { memberId: 'member:gone-archived', workspaceId: 'w1', handle: 'gone-archived', state: 'archived' },
        { memberId: 'member:gone-inactive', workspaceId: 'w1', handle: 'gone-inactive', state: 'inactive' },
      ],
      // Every seat is listed as a Channel member, including the archived and
      // inactive ones: stale membership data, which is what a long-lived
      // Channel accumulates.
      seedChannelMembers: [
        { channelRef: 'channel:engineering', memberId: 'member:joined-a' },
        { channelRef: 'channel:engineering', memberId: 'member:joined-b' },
        { channelRef: 'channel:engineering', memberId: 'member:gone-archived' },
        { channelRef: 'channel:engineering', memberId: 'member:gone-inactive' },
      ],
    })
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    await b.view.findByRole('heading', { name: '# engineering' })
    // Wait for the seeded Channel memberships to reach the composer's roster.
    await screen.findByRole('button', { name: '选择 Agent' })
    const options = await openPicker()
    expect(options).toHaveLength(2)
    expect(options.join('|')).toContain('@joined-a')
    expect(options.join('|')).toContain('@joined-b')
    // The guard is on the Member state, never on membership presence.
    expect(options.join('|')).not.toContain('@gone-archived')
    expect(options.join('|')).not.toContain('@gone-inactive')
    await b.runtime.dispose()
  })
})
