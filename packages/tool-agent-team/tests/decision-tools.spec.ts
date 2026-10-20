import { describe, expect, it } from 'vitest'
import { renderText, teamTools } from './render-text.ts'

const WORKSPACE = 'workspace:alpha'
const THREAD = 'thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e'
const DECISION = 'decision:7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const ANN = 'member:agent-ann'

const questions = [
  { prompt: 'Which release day?', multiple: false, options: [{ label: 'Thursday' }, { label: 'Friday', description: 'As planned.' }], recommended: [1] },
  { prompt: 'Which checks?', multiple: true, options: [{ label: 'Unit' }, { label: 'Browser' }], recommended: [] },
]

/** A fake Host that records what team_ask hands it; the actor is the calling seat, never an argument. */
function session(answered: boolean) {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = []
  const card = { decisionRef: DECISION, channelRef: 'channel:room', threadRef: THREAD, asker: ANN, messageRef: 'message:a', questions,
    askedAt: '', status: 'open' as string, answers: undefined as unknown, closedBy: undefined as unknown }
  const host = {
    workspacesForAgent: () => [{ workspaceId: WORKSPACE }],
    members: () => [{ member: { memberId: ANN, handle: 'ann' } }],
    humanHandle: () => 'Ddv',
    askDecisionForAgent: async (_agent: unknown, request: Record<string, unknown>) => {
      calls.push({ method: 'ask', request })
      return { receipt: {}, message: { messageRef: 'message:a' }, thread: { threadRef: THREAD }, notice: { decisionRef: DECISION, event: 'asked' } }
    },
    withdrawDecisionForAgent: async (_agent: unknown, request: Record<string, unknown>) => {
      calls.push({ method: 'withdraw', request })
      return { receipt: {}, message: {}, thread: {}, notice: { decisionRef: DECISION, event: 'withdrawn' } }
    },
    decisionForAgent: () => card,
    waitInThreadForAgent: async (_agent: unknown, request: Record<string, unknown>, settled: () => unknown, timeoutMs: number) => {
      calls.push({ method: 'wait', request: { ...request, timeoutMs } })
      if (answered) Object.assign(card, { status: 'answered', closedBy: 'member:human', answers: [{ selected: [0] }, { selected: [0, 1], text: 'and lint' }] })
      return settled()
    },
  }
  const agent = { id: 'agent-1', ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  return { calls, exec: { agent, callId: 'call-1', signal: new AbortController().signal } as never }
}

async function run(args: Record<string, unknown>, exec: never): Promise<string> {
  const tool = teamTools().get('team_ask')!
  return renderText(tool, args, await tool.execute(args, exec))
}

describe('team_ask', () => {
  it('posts the card, waits ten minutes on its Thread, and returns the answer', async () => {
    const { calls, exec } = session(true)
    const text = await run({ action: 'ask', threadRef: THREAD, context: 'Plan is ready.', questions, actor: 'member:forged' }, exec)
    expect(calls[0]).toEqual({ method: 'ask', request: { requestId: 'agent-team:tool:agent-1:call-1', workspaceId: WORKSPACE, threadRef: THREAD,
      context: 'Plan is ready.', questions } })
    expect(calls[1]).toEqual({ method: 'wait', request: { workspaceId: WORKSPACE, threadRef: THREAD, timeoutMs: 600_000 } })
    expect(text).toContain(`${DECISION} answered by @Ddv:`)
    expect(text).toContain('1. Which release day? → Thursday')
    expect(text).toContain('2. Which checks? → Unit, Browser + "and lint"')
  })

  it('goes on with the recommended options when no answer comes, and holds questions without one', async () => {
    const { exec } = session(false)
    const text = await run({ action: 'ask', threadRef: THREAD, questions, waitMinutes: 2 }, exec)
    expect(text).toContain(`No answer to ${DECISION} after 2 minute(s). Go ahead with your recommended options:`)
    expect(text).toContain('1. Which release day? → Friday')
    expect(text).toContain('2. Which checks? → no recommended option; hold the work that depends on it.')
    expect(text).toContain('Stop before any step no one can undo.')
  })

  it('reads and withdraws a card by its ref', async () => {
    const { calls, exec } = session(false)
    expect(await run({ action: 'read', decisionRef: DECISION }, exec)).toContain('is open — no answer yet')
    expect(await run({ action: 'withdraw', decisionRef: DECISION }, exec)).toContain(`Committed — withdrew ${DECISION}.`)
    expect(calls.at(-1)).toEqual({ method: 'withdraw', request: { requestId: 'agent-team:tool:agent-1:call-1', workspaceId: WORKSPACE, decisionRef: DECISION } })
    await expect(run({ action: 'ask', questions }, exec)).rejects.toThrow(/threadRef or taskRef/)
  })
})
