/**
 * Model-facing decision card tool: team_ask. A Member asks one to six
 * questions on one card in a Thread, then waits a bounded time for the
 * answer. The card addresses the Human by default, or a named seat while the
 * Task is still in its planning phase; the seat answers with the same tool.
 * With no answer by then the asker goes on with the options it recommended,
 * stopping before any step no one can undo; the answer still arrives later as
 * a Thread mention.
 *
 * The actor is always the calling seat. `execute` copies declared fields only,
 * so an argument a model invents never reaches the Host.
 * @module @ddvnguyen/moct-dsh-team-room/decision-tools
 */

import type {
  AgentTeamDecisionAnswer,
  AgentTeamDecisionQuestion,
  AgentTeamDecisionRef,
  AgentTeamDecisionView,
  AgentTeamMemberId,
  AgentTeamRequestId,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import { AGENT_TEAM_HUMAN_MEMBER_ID } from '@ddvnguyen/moct-dsh-team-room/host'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { service, workspaceOf, workspaceParam, type TeamToolAgent } from './host-access.ts'
import { answerLines, waitMinutesOf, WAIT_MINUTES_DEFAULT, WAIT_MINUTES_MAX } from './wait.ts'

export const DECISION_TOOL_NAMES = Object.freeze(['team_ask'] as const)

function requestId(agentId: string, callId: string): AgentTeamRequestId {
  return `agent-team:tool:${agentId}:${callId}` as AgentTeamRequestId
}

function questionsOf(value: unknown): AgentTeamDecisionQuestion[] {
  if (!Array.isArray(value)) throw new Error('ask requires questions: 1 to 6 objects with prompt, options and recommended')
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`question ${index + 1} must be an object`)
    const question = entry as { prompt?: unknown; multiple?: unknown; options?: unknown; recommended?: unknown }
    if (typeof question.prompt !== 'string') throw new Error(`question ${index + 1} needs a prompt`)
    if (!Array.isArray(question.options)) throw new Error(`question ${index + 1} needs options`)
    const options = question.options.map((option: unknown, optionIndex) => {
      const value = option as { label?: unknown; description?: unknown } | null
      if (value === null || typeof value !== 'object' || typeof value.label !== 'string') throw new Error(`question ${index + 1} option ${optionIndex + 1} needs a label`)
      return { label: value.label, ...(typeof value.description === 'string' ? { description: value.description } : {}) }
    })
    const recommended = Array.isArray(question.recommended) ? question.recommended.filter((pick): pick is number => typeof pick === 'number') : []
    return { prompt: question.prompt, multiple: question.multiple === true, options, recommended }
  })
}

function answersOf(value: unknown): AgentTeamDecisionAnswer[] {
  if (!Array.isArray(value)) throw new Error('answer requires answers: one per question, in question order')
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`answer ${index + 1} must be an object`)
    const answer = entry as { selected?: unknown; text?: unknown }
    if (!Array.isArray(answer.selected)) throw new Error(`answer ${index + 1} needs selected`)
    const selected = answer.selected.filter((pick): pick is number => typeof pick === 'number')
    return { selected, ...(typeof answer.text === 'string' ? { text: answer.text } : {}) }
  })
}

function recommendedLines(view: AgentTeamDecisionView): string[] {
  return view.questions.map((question, index) => question.recommended.length === 0
    ? `${index + 1}. ${question.prompt} → no recommended option; hold the work that depends on it.`
    : `${index + 1}. ${question.prompt} → ${question.recommended.map(pick => question.options[pick]!.label).join(', ')}`)
}

/** The questions as an answerer reads them: every option, in order, with its index. */
function questionLines(view: AgentTeamDecisionView): string[] {
  return view.questions.flatMap((question, index) => [
    `${index + 1}. ${question.prompt}`,
    ...question.options.map((option, optionIndex) => `   ${optionIndex}) ${option.label}`),
  ])
}

/**
 * The seat a card names, from a handle (`@lead`) or a member id. The Host
 * validates the resolved Member against the Workspace and the card's Channel;
 * this only turns what the model wrote into a member id.
 */
function targetOf(host: ReturnType<typeof service>, workspaceId: WorkspaceId, target: string): AgentTeamMemberId {
  const wanted = target.startsWith('@') ? target.slice(1) : target
  const roster = host.membersForClient({ workspaceId })
  const member = roster.find(status => status.member.memberId === wanted || status.member.handle === wanted)
  if (member === undefined) {
    const known = roster.map(status => `@${status.member.handle}`).join(', ')
    throw new Error(`unknown seat '${target}'; the seats in this Workspace are ${known}`)
  }
  return member.member.memberId
}

/** The card as the asker reads it after asking, waiting or reading. */
function cardText(view: AgentTeamDecisionView, handleOf: (memberId: string) => string, waited: number | undefined): string {
  if (view.status === 'answered') {
    return [`${view.decisionRef} answered by ${handleOf(view.closedBy!)}:`, ...answerLines(view), 'Act on these answers; they replace your recommended options.'].join('\n')
  }
  if (view.status === 'withdrawn') return `${view.decisionRef} is withdrawn; it takes no answer.`
  if (view.target !== undefined) {
    return [`${view.decisionRef} is open — it asks ${handleOf(view.target)}. Answer it with action 'answer'.`, ...questionLines(view)].join('\n')
  }
  if (waited === undefined) return [`${view.decisionRef} is open — no answer yet. Your recommended options while it is open:`, ...recommendedLines(view)].join('\n')
  const head = waited === 0
    ? `${view.decisionRef} is open in ${view.threadRef}. Keep working on your recommended options:`
    : `No answer to ${view.decisionRef} after ${waited} minute(s). Go ahead with your recommended options:`
  return [head, ...recommendedLines(view),
    'Stop before any step no one can undo. The answer still reaches you as a mention in this Thread; when it differs from what you assumed, change course. Withdraw the card if you no longer need it.',
  ].join('\n')
}

const teamAsk = defineTool({
  name: 'team_ask',
  description: `Ask a decision in a Thread, on a card with buttons, instead of asking in prose or blocking on a question. One card carries 1 to 6 questions; each has 2 to 4 options (a one- or two-word label and a one-sentence description of what happens), may allow several picks (multiple), and always takes a written answer too. Mark the option you would choose as recommended. The card addresses the Human by default; name a seat with target to ask it instead — target takes a handle (@lead) or a member id, and a card addressed to a seat is a planning-phase question, so it is refused unless the Task is still todo and unclaimed. ask posts the card, which mentions the addressee, then waits up to waitMinutes (default ${WAIT_MINUTES_DEFAULT}, at most ${WAIT_MINUTES_MAX}) for the answer: an answer is returned to you; with none, go ahead on your recommended options and stop before any step no one can undo — the answer still reaches you later as a Thread mention. read shows a card and its answer; answer sends the answer to a card addressed to you, one answer per question in question order; withdraw takes back an open card you no longer need. For a plan or spec to approve, write a Team Document with team_doc instead.`,
  parameters: {
    action: { type: 'string', required: true, enum: ['ask', 'read', 'answer', 'withdraw'] },
    threadRef: { type: 'string', description: "ask: the Thread to post the card in, as a full branded ref ('thread:…'). Or give taskRef." },
    taskRef: { type: 'string', description: "ask: the Task whose Thread gets the card ('task:…'), instead of threadRef." },
    context: { type: 'string', description: 'ask: optional background the addressee needs to answer, at most 1200 characters.' },
    target: { type: 'string', description: "ask: the seat to ask, as a handle ('@lead') or a member id. Omit it to ask the Human. A card addressed to a seat needs its Task to be still todo and unclaimed." },
    questions: {
      type: 'array',
      description: 'ask: 1 to 6 questions, answered together.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          prompt: { type: 'string', required: true, description: 'The question, at most 300 characters.' },
          multiple: { type: 'boolean', description: 'true when several options may be picked together; default false.' },
          options: {
            type: 'array', required: true, description: '2 to 4 options.',
            items: { type: 'object', additionalProperties: false, properties: {
              label: { type: 'string', required: true, description: 'One or two words, at most 40 characters.' },
              description: { type: 'string', description: 'One sentence on what happens if it is picked, at most 200 characters.' },
            } },
          },
          recommended: { type: 'array', items: { type: 'number' }, description: 'Indexes (from 0) of the options you would choose; at most one for a single-choice question.' },
        },
      },
    },
    answers: {
      type: 'array',
      description: 'answer: one answer per question, in question order.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          selected: { type: 'array', items: { type: 'number' }, description: 'Indexes (from 0) of the options to pick; at most one for a single-choice question.' },
          text: { type: 'string', description: 'A written answer, at most 2000 characters.' },
        },
      },
    },
    waitMinutes: { type: 'number', description: `ask: minutes to wait for the answer before going on, 0 to ${WAIT_MINUTES_MAX}; default ${WAIT_MINUTES_DEFAULT}.` },
    decisionRef: { type: 'string', description: "read, answer and withdraw: the card ref ('decision:…') exactly as returned." },
    workspace: workspaceParam,
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', required: true },
      text: { type: 'string', required: true },
      decisionRef: { type: 'string' },
      status: { type: 'string' },
    } },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  timeoutMs: (WAIT_MINUTES_MAX + 1) * 60_000,
  async execute(args, exec) {
    const agent = exec.agent as TeamToolAgent | undefined
    if (agent === undefined) throw new Error('team_ask requires an Agent session')
    const host = service(agent)
    const workspaceId = workspaceOf(args, agent)
    const handleOf = (memberId: string): string => {
      if (memberId === AGENT_TEAM_HUMAN_MEMBER_ID) return `@${host.humanHandle()}`
      return `@${host.members().find(status => status.member.memberId === memberId)?.member.handle ?? memberId}`
    }
    switch (args.action) {
      case 'ask': {
        if (args.threadRef === undefined && args.taskRef === undefined) throw new Error('ask requires threadRef or taskRef')
        const waitMinutes = waitMinutesOf(args.waitMinutes)
        const result = await host.askDecisionForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId,
          ...(args.threadRef === undefined ? {} : { threadRef: args.threadRef as AgentTeamThreadRef }),
          ...(args.taskRef === undefined ? {} : { taskRef: args.taskRef as AgentTeamTaskRef }),
          ...(args.context === undefined ? {} : { context: args.context }),
          ...(args.target === undefined ? {} : { target: targetOf(host, workspaceId, args.target) }), questions: questionsOf(args.questions) })
        const decisionRef = result.notice.decisionRef
        const read = (): AgentTeamDecisionView => host.decisionForAgent(agent, { workspaceId, decisionRef })
        const settled = waitMinutes === 0 ? undefined : await host.waitInThreadForAgent(agent, { workspaceId, threadRef: result.thread.threadRef },
          () => { const view = read(); return view.status === 'open' ? undefined : view }, waitMinutes * 60_000, exec.signal)
        const view = settled ?? read()
        return { kind: 'committed', decisionRef, status: view.status,
          text: `Committed — asked ${decisionRef} in ${result.thread.threadRef}.\n${cardText(view, handleOf, view.status === 'open' ? waitMinutes : undefined)}` }
      }
      case 'read': {
        if (args.decisionRef === undefined) throw new Error('read requires decisionRef')
        const view = host.decisionForAgent(agent, { workspaceId, decisionRef: args.decisionRef as AgentTeamDecisionRef })
        return { kind: 'read', decisionRef: view.decisionRef, status: view.status, text: cardText(view, handleOf, undefined) }
      }
      case 'answer': {
        if (args.decisionRef === undefined) throw new Error('answer requires decisionRef')
        const result = await host.answerDecisionForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId,
          decisionRef: args.decisionRef as AgentTeamDecisionRef, answers: answersOf(args.answers) })
        return { kind: 'committed', decisionRef: result.notice.decisionRef, status: 'answered',
          text: `Committed — answered ${result.notice.decisionRef}. The asker is woken by this answer.` }
      }
      case 'withdraw': {
        if (args.decisionRef === undefined) throw new Error('withdraw requires decisionRef')
        const result = await host.withdrawDecisionForAgent(agent, { requestId: requestId(agent.id, exec.callId), workspaceId,
          decisionRef: args.decisionRef as AgentTeamDecisionRef })
        return { kind: 'committed', decisionRef: result.notice.decisionRef, status: 'withdrawn', text: `Committed — withdrew ${result.notice.decisionRef}.` }
      }
    }
  },
})

export const decisionTools = [teamAsk] as const

export function registerDecisionTools(ctx: { tools: { register(tool: unknown): unknown } }): void {
  for (const tool of decisionTools) ctx.tools.register(tool)
}
