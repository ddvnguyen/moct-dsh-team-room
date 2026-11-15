// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import type { ActivitySource } from '../src/client/multica/types.ts'
import { IssueRunningAgents, runningAgentCards, type IssueRunningAgentsProps } from '../src/client/issue/IssueRunningAgents.tsx'

const translate = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}) as unknown as TeamConversationProps['t']

afterEach(() => { cleanup(); vi.useRealTimers() })

const threadRef = 'thread:one' as AgentTeamThreadRef
const otherThread = 'thread:two' as AgentTeamThreadRef
const ann = 'member:ann' as AgentTeamMemberId
const bob = 'member:bob' as AgentTeamMemberId

/** A roster seat with its instance slots; slot 0 is the seat's home Session. */
function seat(
  memberId: AgentTeamMemberId,
  handle: string,
  slots: readonly { readonly slot: number; readonly sessionId?: string; readonly presence?: string; readonly threadRefs?: readonly string[] }[],
): AgentTeamClientMemberStatus {
  return {
    member: { memberId, handle, description: '', sessionId: `session:${memberId}:main` },
    workspaceIds: [],
    availability: 'active',
    presence: 'working',
    capabilityState: 'applied',
    instances: slots.map(slot => ({
      slot: slot.slot,
      presence: slot.presence ?? 'available',
      threadRefs: slot.threadRefs ?? [threadRef],
      ...(slot.sessionId === undefined ? {} : { sessionId: slot.sessionId }),
    })),
  } as unknown as AgentTeamClientMemberStatus
}

const annSeat = seat(ann, 'ann', [{ slot: 0, sessionId: 'session:ann' }])
const bobSeat = seat(bob, 'bob', [{ slot: 0, sessionId: 'session:bob:0' }, { slot: 1, sessionId: 'session:bob:1' }])
const members = [annSeat, bobSeat]

function activity(overrides: Partial<ActivitySource> & { readonly memberId: string }): ActivitySource {
  return {
    handle: `@${overrides.memberId.split(':').pop()}`,
    threadRef,
    turnStartedAt: '2026-10-25T10:00:00.000Z',
    stepCount: 1,
    toolCount: 0,
    updatedAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  }
}

function renderCards(overrides: Partial<IssueRunningAgentsProps> = {}) {
  const onOpenSession = vi.fn()
  const onStop = vi.fn()
  const view = render(<IssueRunningAgents
    members={members}
    threadRef={threadRef}
    activities={[]}
    stopping={new Set()}
    onOpenSession={onOpenSession}
    onStop={onStop}
    t={translate}
    {...overrides}
  />)
  return { view, onOpenSession, onStop }
}

describe('runningAgentCards', () => {
  it('draws one card per (seat, slot) the feed is running, with the roster’s Session for it', () => {
    const cards = runningAgentCards(members, [
      activity({ memberId: ann }),
      activity({ memberId: bob, slot: 1 }),
    ], threadRef)
    expect(cards.map(card => `${card.memberId}#${card.slot}`)).toEqual([`${ann}#0`, `${bob}#1`])
    expect(cards.map(card => card.sessionId)).toEqual(['session:ann', 'session:bob:1'])
  })

  it('draws a card for a slot the roster reports is working before the feed folds it', () => {
    const busy = seat(bob, 'bob', [{ slot: 0, sessionId: 'session:bob:0', presence: 'working' }])
    const cards = runningAgentCards([busy], [], threadRef)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ memberId: bob, slot: 0, sessionId: 'session:bob:0', steps: [] })
  })

  it('ignores a Turn delivered for another Thread, and a seat whose slots are idle', () => {
    const idle = seat(bob, 'bob', [{ slot: 0, presence: 'available' }])
    expect(runningAgentCards([idle], [activity({ memberId: bob, threadRef: otherThread })], threadRef)).toEqual([])
  })

  it('names the seat handle without its @, whichever source named the seat first', () => {
    const cards = runningAgentCards(members, [activity({ memberId: ann, handle: '@ann' })], threadRef)
    expect(cards[0]?.handle).toBe('ann')
  })
})

describe('IssueRunningAgents', () => {
  it('renders nothing on a quiet board', () => {
    const { view } = renderCards()
    expect(view.container.querySelector('[data-issue-running-agents]')).toBeNull()
  })

  it('gives one card per seat and slot, and names the slot only where the seat has more than one', () => {
    const { view } = renderCards({
      activities: [activity({ memberId: ann }), activity({ memberId: bob, slot: 0 }), activity({ memberId: bob, slot: 1 })],
    })
    const cards = [...view.container.querySelectorAll('[data-running-agent]')] as HTMLElement[]
    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.getAttribute('data-running-agent'))).toEqual([ann, bob, bob])
    // Only the two-slot seat carries a chip: a single slot has nothing to choose.
    const chips = [...view.container.querySelectorAll('[data-running-slot-chip]')].map(node => node.textContent)
    expect(chips).toEqual(['实例 0', '实例 1'])
  })

  it('ticks the elapsed time and counts the tool calls from the Host’s step feed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T10:01:30.000Z'))
    const { view } = renderCards({
      activities: [activity({
        memberId: ann,
        turnStartedAt: '2026-10-25T10:00:00.000Z',
        toolCount: 4,
        steps: [{ tool: 'read', label: 'read a.ts' }, { tool: 'edit', label: 'edit b.ts' }],
      })],
    })
    expect(view.getByText(zh.runCardWorking)).toBeTruthy()
    expect(view.container.querySelector('[data-run-elapsed]')?.textContent).toBe('1m 30s')
    expect(view.container.querySelector('[data-run-tool-count]')?.textContent).toBe('4 个工具')
    // The newest step is the present tense; the ones before it are the Turn's shape.
    const lines = [...view.container.querySelectorAll('[data-running-step]')].map(node => node.textContent)
    expect(lines).toEqual(['现在编辑 b.ts', '读取 a.ts'])
  })

  it('says the Turn is thinking while it has called nothing, and shows no figure it does not have', () => {
    const { view } = renderCards({ members: [seat(ann, 'ann', [{ slot: 0, sessionId: 'session:ann', presence: 'working' }])], activities: [] })
    expect(view.getByText(zh.runStepNowThinking)).toBeTruthy()
    expect(view.container.querySelector('[data-run-elapsed]')).toBeNull()
    expect(view.container.querySelector('[data-run-tool-count]')).toBeNull()
  })

  it('opens the slot’s native session and asks before stopping it', () => {
    const { view, onOpenSession, onStop } = renderCards({ activities: [activity({ memberId: ann })] })
    fireEvent.click(view.getByRole('button', { name: zh.openSession }))
    expect(onOpenSession).toHaveBeenCalledWith('session:ann')

    // Stop asks first: nothing is written until the dialog is confirmed.
    fireEvent.click(view.getByRole('button', { name: zh.stopRun }))
    expect(onStop).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: zh.stopRunTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.stopRun }))
    expect(onStop).toHaveBeenCalledWith('session:ann')
  })

  it('reads “stopping…” from the click and offers no second Stop until the Host refolds', () => {
    const { view } = renderCards({ activities: [activity({ memberId: ann })], stopping: new Set(['session:ann']) })
    const card = view.container.querySelector('[data-running-agent]') as HTMLElement
    expect(card.getAttribute('data-run-state')).toBe('stopping')
    expect(within(card).getByText(zh.stopRunStopping)).toBeTruthy()
    expect(within(card).queryByRole('button', { name: zh.stopRun })).toBeNull()
  })

  it('offers neither control for a slot the roster gives no Session, and keeps the card’s facts', () => {
    const { view } = renderCards({ members: [seat(ann, 'ann', [{ slot: 0 }])], activities: [activity({ memberId: ann, toolCount: 2 })] })
    expect(view.getByText(zh.runCardWorking)).toBeTruthy()
    for (const label of [zh.openSession, zh.stopRun]) {
      expect((view.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
