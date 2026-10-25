import { describe, expect, it } from 'vitest'
import type {
  AgentTeamIssueActivityFact, AgentTeamIssueComment, AgentTeamMemberId, AgentTeamSessionRun,
} from '@ddvnguyen/moct-dsh-team-room/types'
import { buildTimeline, commentWindowStart, timelineRuns } from '../src/client/issue/timeline.ts'

const taskRef = 'task:1' as never
const threadRef = 'thread:1' as never
const human = 'member:human' as AgentTeamMemberId

/** A comment fact at one instant; the sequence is the ledger's own. */
function comment(sequence: number, at: string, body = `comment ${sequence}`): AgentTeamIssueComment {
  return {
    kind: 'message',
    sequence,
    message: {
      messageRef: `message:${sequence}` as never,
      channelRef: 'channel:room' as never,
      threadRef,
      taskRef,
      sender: human,
      body,
      topLevel: true,
      sequence,
      occurredAt: at,
    },
    mentions: [],
    occurredAt: at,
  }
}

/** An activity fact at one instant, carrying the ordering key the merge reads. */
function activity(sequence: number, at: string): AgentTeamIssueActivityFact {
  return {
    kind: 'activity',
    sequence,
    occurredAt: at,
    activity: {
      kind: 'promote',
      actor: human,
      sequence,
      activityRef: `activity:${sequence}` as never,
      taskRef,
      threadRef,
    },
  }
}

function run(sessionId: string, startedAt: string, endedAt = startedAt): AgentTeamSessionRun {
  return {
    sessionId: sessionId as never,
    memberId: human,
    threadRefs: [threadRef],
    startedAt,
    endedAt,
    turns: 1,
    tokensIn: 0,
    unknownInputTurns: 0,
    tokensOut: 0,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    toolCalls: 0,
    runMs: 0,
    model: null,
    lastAssistantAt: endedAt,
  }
}

/** One row's identity, so an assertion names the shape and not a whole object. */
function shape(row: ReturnType<typeof buildTimeline>[number]): string {
  if (row.kind === 'comment') return `comment:${row.entry.message.messageRef}`
  if (row.kind === 'run') return `run:${row.run.sessionId}`
  return `group:${row.entries.map(entry => entry.activity.activityRef).join('+')}`
}

describe('buildTimeline', () => {
  it('puts an activity between the two comments it happened between', () => {
    const rows = buildTimeline({
      comments: [comment(1, '2026-10-22T01:00:00.000Z'), comment(3, '2026-10-22T03:00:00.000Z')],
      activity: [activity(2, '2026-10-22T02:00:00.000Z')],
      runs: [],
      windowStart: null,
    })
    expect(rows.map(shape)).toEqual(['comment:message:1', 'group:activity:2', 'comment:message:3'])
  })

  it('folds consecutive activities into one group and splits them at a comment', () => {
    const rows = buildTimeline({
      comments: [comment(3, '2026-10-22T03:00:00.000Z')],
      activity: [
        activity(1, '2026-10-22T01:00:00.000Z'),
        activity(2, '2026-10-22T02:00:00.000Z'),
        activity(4, '2026-10-22T04:00:00.000Z'),
      ],
      runs: [],
      windowStart: null,
    })
    expect(rows.map(shape)).toEqual([
      'group:activity:1+activity:2',
      'comment:message:3',
      'group:activity:4',
    ])
  })

  it('keeps the comment first when an activity shares its instant', () => {
    const at = '2026-10-22T01:00:00.000Z'
    const rows = buildTimeline({ comments: [comment(1, at)], activity: [activity(2, at)], runs: [], windowStart: null })
    expect(rows.map(shape)).toEqual(['comment:message:1', 'group:activity:2'])
  })

  it('drops everything older than the window when the comment page is partial', () => {
    const comments = {
      items: [comment(5, '2026-10-22T05:00:00.000Z')],
      hasMore: true,
    }
    const rows = buildTimeline({
      comments: comments.items,
      activity: [activity(1, '2026-10-22T01:00:00.000Z'), activity(6, '2026-10-22T06:00:00.000Z')],
      runs: [timelineRuns([{ active: null, history: [run('session:old', '2026-10-22T02:00:00.000Z')] }])[0]!],
      windowStart: commentWindowStart(comments),
    })
    // The older activity and the older run would leave a gap between the page
    // and the history, so neither is drawn.
    expect(rows.map(shape)).toEqual(['comment:message:5', 'group:activity:6'])
  })

  it('draws the whole history when the page is the history', () => {
    expect(commentWindowStart({ items: [comment(5, '2026-10-22T05:00:00.000Z')], hasMore: false })).toBeNull()
  })
})

describe('timelineRuns', () => {
  it('flags the live run and keeps one row per Session', () => {
    const live = run('session:live', '2026-10-22T01:00:00.000Z', '2026-10-22T01:00:00.000Z')
    const done = run('session:done', '2026-10-22T00:00:00.000Z', '2026-10-22T00:30:00.000Z')
    const rows = timelineRuns([
      { active: live, history: [done, live] },
      { active: null, history: [done] },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.run.sessionId === 'session:live')?.running).toBe(true)
    expect(rows.find(row => row.run.sessionId === 'session:done')?.running).toBe(false)
  })
})
