import { describe, expect, it } from 'vitest'
import { renderText, teamTools } from './render-text.ts'

const WORKSPACE = 'workspace:alpha'
const CHANNEL = 'channel:room'
const THREAD = 'thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e'
const ANN = 'member:agent-ann'
const BOB = 'member:agent-bob'
const HUMAN = 'member:human'

/**
 * A fake Host that answers the five reads team_activity makes and records the
 * roomActivity requests, so the tests can pin the window the tool derives and
 * the fields it copies. Only the fields the tool actually reads exist.
 */
function session(options: { readonly channels?: readonly string[] } = {}) {
  const roomRequests: Array<Record<string, unknown>> = []
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000).toISOString()
  const host = {
    workspacesForAgent: () => [{ workspaceId: WORKSPACE }],
    humanHandle: () => 'Ddv',
    members: () => [
      { member: { memberId: ANN, handle: 'ann', role: undefined }, availability: 'active', presence: 'working' },
      { member: { memberId: BOB, handle: 'bob', role: undefined }, availability: 'active', presence: 'available' },
      { member: { memberId: HUMAN, handle: 'Ddv', role: undefined }, availability: 'active', presence: 'available' },
    ],
    memberActivity: () => ({
      revision: 1,
      activities: [{ memberId: ANN, handle: 'ann', threadRef: THREAD, turnStartedAt: tenMinutesAgo, stepCount: 3, toolCount: 2, current: { tool: 'bash', label: 'running tests' }, updatedAt: tenMinutesAgo }],
    }),
    openDecisionsForAgent: () => [
      { decisionRef: 'decision:a', threadRef: THREAD, askedAt: twentyMinutesAgo, questions: [{ prompt: 'Q1' }], status: 'open' },
      { decisionRef: 'decision:b', threadRef: THREAD, askedAt: tenMinutesAgo, questions: [{ prompt: 'Q1' }, { prompt: 'Q2' }], status: 'open' },
    ],
    viewForAgent: (_agent: unknown, request: Record<string, unknown>) => {
      calls.viewRequests.push(request)
      return {
        humanMemberId: HUMAN,
        channels: (options.channels ?? [CHANNEL]).map(ref => ({ channelRef: ref, name: ref === CHANNEL ? 'room' : 'digest', workspaceId: WORKSPACE, state: 'active' })),
        members: [{ channelRef: CHANNEL, memberId: ANN }, { channelRef: CHANNEL, memberId: BOB }, { channelRef: CHANNEL, memberId: HUMAN }],
        tasks: [
          { taskRef: 'task:one', channelRef: CHANNEL, threadRef: THREAD, status: 'todo', resolution: 'open', title: 'Fix the flaky window test', priority: 'high', assignee: BOB },
          { taskRef: 'task:two', channelRef: CHANNEL, threadRef: THREAD, status: 'done', resolution: 'accepted' },
          { taskRef: 'task:three', channelRef: CHANNEL, threadRef: THREAD, status: 'in_review', resolution: 'open' },
        ],
        activeTaskThreads: [{ taskRef: 'task:three', threadRef: 'thread:t3', channelRef: CHANNEL, status: 'in_review', subject: 'Review windowed usage', lastActivityAt: tenMinutesAgo, members: [{ memberId: ANN, name: 'ann' }] }],
        items: [{ thread: { threadRef: THREAD }, lastActivityAt: twentyMinutesAgo }],
        cursor: 1,
        hasMore: false,
      }
    },
    roomActivity: (request: Record<string, unknown>) => {
      roomRequests.push(request)
      return {
        scope: 'channel',
        totals: { messages: 3, turns: 5, tokensIn: null, tokensOut: 300, cacheRead: null, cacheWrite: null, toolCalls: 7, runMs: 45_000, failedTurns: 1, unrecordedTurns: 1 },
        perAgent: [
          { memberId: ANN, messages: 3, turns: 4, tokensIn: 1200, tokensOut: 300, cacheRead: null, cacheWrite: 50, toolCalls: 7, runMs: 40_000, failedTurns: 1, sessionIds: [] },
          { memberId: BOB, messages: 0, turns: 1, tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: null, toolCalls: 0, runMs: 5_000, failedTurns: 0, sessionIds: [] },
        ],
        sessions: [{ sessionId: 'session:bob', memberId: BOB, lastAssistantAt: tenMinutesAgo, turns: 1 }],
        events: [
          { sequence: 9, at: tenMinutesAgo, kind: 'team/message-sent', actor: '@ann', summary: 'posted the first digest' },
          { sequence: 8, at: twentyMinutesAgo, kind: 'team/decision-asked', actor: '@bob', summary: 'asked which release day' },
        ],
      }
    },
  }
  const calls = { viewRequests: [] as Array<Record<string, unknown>> }
  const agent = { id: 'agent-1', ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  return { roomRequests, calls, exec: { agent, callId: 'call-1', signal: new AbortController().signal } as never }
}

async function run(args: Record<string, unknown>, exec: never): Promise<string> {
  const tool = teamTools().get('team_activity')!
  return renderText(tool, args, await tool.execute(args, exec))
}

describe('team_activity', () => {
  it('merges the per-agent window, marks the sticky-null buckets unknown, and derives idle minutes from session activity', async () => {
    const { exec } = session()
    const text = await run({ sinceMinutes: 90 }, exec)
    expect(text).toContain('read-only')
    expect(text).toContain('@ann (working) · running bash')
    expect(text).toContain('turns 4 · in 1,200 · out 300 · failed 1')
    // Bob's last proven activity is ten minutes ago; the idle line is derived, not asserted to the minute.
    expect(text).toMatch(/- @bob \(available\) · idle \d+m · turns 1 · in unknown · out unknown · failed 0/)
    // The Human row is not an agent and carries no windowed usage: turns 0, unknown buckets.
    expect(text).toContain('@Ddv (available) · turns 0 · in unknown')
  })

  it('scopes the window to the caller\'s own channels and hands the Host the derived since instant', async () => {
    const { roomRequests, exec } = session({ channels: [CHANNEL, 'channel:digest'] })
    await run({ sinceMinutes: 90 }, exec)
    expect(roomRequests).toHaveLength(2)
    const since = roomRequests[0]!.since as string
    for (const request of roomRequests) {
      expect(request).toMatchObject({ workspaceId: WORKSPACE, since, limit: 15 })
    }
    expect(Date.now() - Date.parse(since)).toBeGreaterThanOrEqual(90 * 60_000 - 5_000)
    expect(Date.now() - Date.parse(since)).toBeLessThan(90 * 60_000 + 5_000)
  })

  it('reports tasks by status, the open rows oldest-first, and open decisions with an explicit question count', async () => {
    const { exec } = session()
    const text = await run({ sinceMinutes: 90 }, exec)
    expect(text).toContain('todo 1 · in_progress 0 · in_review 1 · done 1 · closed 0')
    expect(text).toMatch(/- task:one · todo · high · assignee @member:agent-bob — Fix the flaky window test/)
    expect(text).toContain('- decision:a · thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e · asked')
    expect(text).toContain('2 question(s)')
  })

  it('marks truncation explicitly when a cap is crossed', async () => {
    const { exec } = session({ channels: Array.from({ length: 20 }, (_, index) => `channel:c${index}`) })
    const text = await run({ sinceMinutes: 90 }, exec)
    expect(text).toContain('+ more events beyond this page are not shown.')
  })

  it('rejects a non-positive window and defaults to one day', async () => {
    const { exec } = session()
    await expect(run({ sinceMinutes: 0 }, exec)).rejects.toThrow(/positive whole number/)
    const { roomRequests, exec: idleExec } = session()
    await run({}, idleExec)
    expect(Date.now() - Date.parse(roomRequests[0]!.since as string)).toBeGreaterThan(1440 * 60_000 - 5_000)
  })
})
