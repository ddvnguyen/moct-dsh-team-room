// @vitest-environment node
//
// The Agent page's pure derivations: the current Task, today's tokens, the
// Stop targets and the 14-day token buckets. These are the facts the roster
// row and the detail header both read, so they are pinned here without a DOM.
import { describe, expect, it } from 'vitest'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamMemberActivity,
  AgentTeamSessionRun,
  AgentTeamTask,
  AgentTeamThreadTurnFailure,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import {
  cacheHitLabel,
  currentTaskOf,
  failuresBySession,
  formatRunTime,
  groupTasksByStatus,
  instanceLoad,
  isMemberBusy,
  memberTaskRows,
  stopTargets,
  tokenBuckets,
  tokensToday,
  tokensOfRun,
} from '../../src/client/agents/agent-page-model.ts'
import { toDateOnly } from '../../src/client/multica/date.ts'
import { deriveAvailability } from '../../src/client/multica/derive-presence.ts'

const status = (over: Record<string, unknown> = {}): AgentTeamClientMemberStatus => ({
  member: {
    memberId: 'member:a',
    sessionId: 'session:home',
    handle: '@alpha',
    description: '',
    state: 'active',
    presetId: 'team-member',
    workspaceIds: [],
    instances: 1,
  },
  instances: [{ slot: 0, sessionId: 'session:home', presence: 'available', threadRefs: [] }],
  workspaceIds: ['w1'],
  availability: 'active',
  presence: 'available',
  capabilityState: 'applied',
  ...over,
} as unknown as AgentTeamClientMemberStatus)

const task = (over: Record<string, unknown>): AgentTeamTask => {
  const taskRef = String(over.taskRef ?? 'task:1')
  return {
    taskRef,
    channelRef: 'channel:eng',
    threadRef: `thread:${taskRef}`,
    status: 'todo',
    resolution: 'open',
    ...over,
  } as unknown as AgentTeamTask
}

const view = (tasks: readonly AgentTeamTask[], claims: readonly unknown[] = []): AgentTeamView => ({
  humanMemberId: 'member:human',
  workspaces: [],
  channels: [{ channelRef: 'channel:eng', name: 'engineering' }],
  members: [],
  tasks,
  threads: [],
  taskNumbers: tasks.map((row, index) => ({ taskRef: row.taskRef, taskNumber: index + 1 })),
  items: [],
  activeTaskThreads: [],
  claims,
  activities: [],
  cursor: 0,
  hasMore: false,
} as unknown as AgentTeamView)

const claim = (over: Record<string, unknown>): unknown => ({
  claimRef: 'claim:1',
  taskRef: 'task:2',
  threadRef: 'thread:task:2',
  owner: 'member:a',
  direction: 'implement',
  normalizedDirection: 'implement',
  state: 'active',
  ...over,
})

const run = (sessionId: string, startedAt: string, tokensIn: number, tokensOut: number): AgentTeamSessionRun => ({
  sessionId,
  memberId: 'member:a',
  threadRefs: [],
  startedAt,
  endedAt: startedAt,
  turns: 1,
  tokensIn,
  unknownInputTurns: 0,
  tokensOut,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  toolCalls: 0,
  runMs: 1_000,
  model: null,
  lastAssistantAt: startedAt,
} as unknown as AgentTeamSessionRun)

const activity = (over: Record<string, unknown> = {}): AgentTeamMemberActivity => ({
  memberId: 'member:a',
  handle: '@alpha',
  turnStartedAt: '2026-10-19T10:00:00.000Z',
  stepCount: 1,
  toolCount: 1,
  current: { tool: 'bash', label: 'Running tests' },
  updatedAt: '2026-10-19T10:00:00.000Z',
  ...over,
} as unknown as AgentTeamMemberActivity)

const failure = (sessionId: string, sequence: number): AgentTeamThreadTurnFailure => ({
  sequence,
  occurredAt: '2026-10-19T10:00:00.000Z',
  threadRef: 'thread:1',
  memberId: 'member:a',
  handle: '@alpha',
  sessionId,
  turn: 1,
  reason: 'boom',
} as unknown as AgentTeamThreadTurnFailure)

describe('the Stop targets', () => {
  it('covers slot 0 and every working instance, once each', () => {
    const targets = stopTargets(status({
      instances: [
        { slot: 0, sessionId: 'session:home', presence: 'working', threadRefs: [] },
        { slot: 1, sessionId: 'session:side', presence: 'working', threadRefs: [] },
        { slot: 2, sessionId: 'session:idle', presence: 'available', threadRefs: [] },
      ],
    }))
    expect(targets.map(target => target.sessionId)).toEqual(['session:home', 'session:side'])
  })

  it('never cancels the same Session twice when a slot repeats the seat session', () => {
    const targets = stopTargets(status({
      instances: [
        { slot: 0, sessionId: 'session:home', presence: 'working', threadRefs: [] },
        { slot: 1, sessionId: 'session:home', presence: 'working', threadRefs: [] },
      ],
    }))
    expect(targets.map(target => target.sessionId)).toEqual(['session:home'])
  })

  it('skips an instance with no live Session', () => {
    const targets = stopTargets(status({
      instances: [
        { slot: 0, sessionId: 'session:home', presence: 'available', threadRefs: [] },
        { slot: 1, presence: 'working', threadRefs: [] },
      ],
    }))
    expect(targets.map(target => target.sessionId)).toEqual(['session:home'])
  })
})

describe('the busy state', () => {
  it('is true while a Turn runs, a slot works, or the seat is working', () => {
    expect(isMemberBusy(status(), [])).toBe(false)
    expect(isMemberBusy(status(), [activity()])).toBe(true)
    expect(isMemberBusy(status({ presence: 'working' }), [])).toBe(true)
    expect(isMemberBusy(status({
      instances: [{ slot: 0, sessionId: 'session:home', presence: 'working', threadRefs: [] }],
    }), [])).toBe(true)
  })
})

describe('the presence dimension', () => {
  it('reads archived and suspended seats as archived or offline, and an erroring seat as unstable', () => {
    expect(deriveAvailability(status())).toBe('online')
    expect(deriveAvailability(status({ availability: 'archived' }))).toBe('archived')
    expect(deriveAvailability(status({ availability: 'inactive' }))).toBe('archived')
    expect(deriveAvailability(status({ availability: 'suspended' }))).toBe('offline')
    expect(deriveAvailability(status({ availability: 'unavailable' }))).toBe('offline')
    expect(deriveAvailability(status({ presence: 'error' }))).toBe('unstable')
  })
})

describe('the instance load', () => {
  it('counts the working instances over the total', () => {
    expect(instanceLoad(status())).toEqual({ busy: 0, total: 1 })
    expect(instanceLoad(status({
      instances: [
        { slot: 0, sessionId: 'session:home', presence: 'working', threadRefs: [] },
        { slot: 1, sessionId: 'session:side', presence: 'available', threadRefs: [] },
      ],
    }))).toEqual({ busy: 1, total: 2 })
  })
})

describe('the Member Tasks', () => {
  it('keeps the assigned and the claimed Tasks, ordered by board position', () => {
    const rows = memberTaskRows(view([
      task({ taskRef: 'task:1', title: 'Assigned', assignee: 'member:a', position: 2 }),
      task({ taskRef: 'task:2', title: 'Claimed', position: 1 }),
      task({ taskRef: 'task:3', title: 'Other', assignee: 'member:b', position: 0 }),
    ], [claim({})]), 'member:a')
    expect(rows.map(row => row.taskRef)).toEqual(['task:2', 'task:1'])
    expect(rows[0]?.claimDirection).toBe('implement')
    expect(rows[1]?.claimDirection).toBeUndefined()
    expect(rows[1]?.title).toBe('Assigned')
    expect(rows[1]?.taskNumber).toBe(1)
  })

  it('takes the live Turn’s Task as the current one, else the claimed Task', () => {
    const catalog = view([
      task({ taskRef: 'task:1', title: 'Assigned', assignee: 'member:a' }),
      task({ taskRef: 'task:2', title: 'Claimed' }),
    ], [claim({})])
    expect(currentTaskOf(catalog, 'member:a', activity({ threadRef: 'thread:task:1' }))?.taskRef).toBe('task:1')
    expect(currentTaskOf(catalog, 'member:a', activity())?.taskRef).toBe('task:2')
    expect(currentTaskOf(catalog, 'member:a', undefined)?.taskRef).toBe('task:2')
  })

  it('groups by status in board order and drops the empty groups', () => {
    const groups = groupTasksByStatus(memberTaskRows(view([
      task({ taskRef: 'task:1', status: 'done', assignee: 'member:a' }),
      task({ taskRef: 'task:2', status: 'todo', assignee: 'member:a' }),
    ]), 'member:a'))
    expect(groups.map(group => group.status)).toEqual(['todo', 'done'])
    expect(groups[0]?.rows.map(row => row.taskRef)).toEqual(['task:2'])
  })
})

describe('the token accounting', () => {
  it('counts only the runs that started today', () => {
    const today = toDateOnly(new Date())
    const yesterday = toDateOnly(new Date(Date.now() - 86_400_000))
    const runs = [run('session:a', `${today}T09:00:00.000Z`, 1_000, 500), run('session:b', `${yesterday}T09:00:00.000Z`, 4_000, 4_000)]
    expect(tokensToday(runs)).toBe(1_500)
    expect(tokensOfRun(runs[0]!)).toBe(1_500)
  })

  it('buckets 14 days of tokens and splits the failed share out of each day', () => {
    const today = toDateOnly(new Date())
    const runs = [run('session:a', `${today}T09:00:00.000Z`, 1_000, 0), run('session:b', `${today}T10:00:00.000Z`, 1_000, 0)]
    const buckets = tokenBuckets(runs, new Set(['session:b']))
    expect(buckets).toHaveLength(14)
    expect(buckets[13]?.day).toBe(today)
    expect(buckets[13]?.total).toBe(2_000)
    expect(buckets[13]?.failed).toBe(1_000)
    expect(buckets[13]?.completed).toBe(1_000)
    expect(buckets[0]?.total).toBe(0)
  })

  it('reads the cache share of the input side, and never guesses a missing one', () => {
    expect(cacheHitLabel({ tokensIn: 1_000, cacheReadTokens: 3_000 })).toBe('75%')
    expect(cacheHitLabel({ tokensIn: 0, cacheReadTokens: 0 })).toBe('—')
    expect(cacheHitLabel({ tokensIn: 10, cacheReadTokens: null })).toBe('—')
  })
})

describe('the run labels', () => {
  it('formats the wall time as seconds, minutes and hours', () => {
    expect(formatRunTime(42_000)).toBe('42s')
    expect(formatRunTime(185_000)).toBe('3m 5s')
    expect(formatRunTime(8_040_000)).toBe('2h 14m')
    expect(formatRunTime(-5)).toBe('0s')
  })
})

describe('the failure grouping', () => {
  it('groups failures by Session, newest first inside each Session', () => {
    const grouped = failuresBySession([failure('session:a', 3), failure('session:a', 7), failure('session:b', 5)])
    expect(grouped.get('session:a')?.map(row => row.sequence)).toEqual([7, 3])
    expect(grouped.get('session:b')?.map(row => row.sequence)).toEqual([5])
  })
})
