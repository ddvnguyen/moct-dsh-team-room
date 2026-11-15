import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AgentTeamChannelRef,
  AgentTeamDecisionAnswer,
  AgentTeamDecisionNotice,
  AgentTeamDecisionOption,
  AgentTeamDecisionQuestion,
  AgentTeamDecisionRecord,
  AgentTeamDecisionRecordRef,
  AgentTeamDecisionRecordSource,
  AgentTeamDecisionRef,
  AgentTeamDecisionStatus,
  AgentTeamDecisionView,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from './types.ts'

export const DECISION_MAX_QUESTIONS = 6
export const DECISION_MIN_OPTIONS = 2
export const DECISION_MAX_OPTIONS = 4
export const DECISION_PROMPT_LIMIT = 300
export const DECISION_CONTEXT_LIMIT = 1200
export const DECISION_LABEL_LIMIT = 40
export const DECISION_DESCRIPTION_LIMIT = 200
export const DECISION_ANSWER_TEXT_LIMIT = 2000

/** How many current Owner decisions an agent-facing read carries: the newest ones. */
export const OWNER_DECISIONS_LIMIT = 10

/**
 * Replay-derived state of one decision card. The ledger rebuilds it from the
 * ask, answer and withdraw notices carried by Thread replies; it is never a
 * second durable authority.
 */
export interface AgentTeamDecisionState {
  readonly decisionRef: AgentTeamDecisionRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly asker: AgentTeamMemberId
  readonly messageRef: AgentTeamMessageRef
  readonly context?: string
  /** The seat the card addresses; absent on a card that addresses the Human. */
  readonly target?: AgentTeamMemberId
  readonly questions: readonly AgentTeamDecisionQuestion[]
  readonly askedAt: string
  readonly status: AgentTeamDecisionStatus
  readonly answers?: readonly AgentTeamDecisionAnswer[]
  readonly closedBy?: AgentTeamMemberId
  readonly closedAt?: string
}

/**
 * Replay-derived state of one recorded decision. The ledger rebuilds it from
 * the decision record the operation carries, or — for an operation written
 * before decision records existed — from the notice that operation already
 * carried. It is never a second durable authority.
 */
export interface AgentTeamDecisionRecordState {
  readonly recordRef: AgentTeamDecisionRecordRef
  readonly taskRef?: AgentTeamTaskRef
  readonly decidedBy: AgentTeamMemberId
  readonly decided: string
  readonly rationale: string
  readonly decidedAt: string
  readonly source: AgentTeamDecisionRecordSource
}

function bounded(value: string, limit: number, name: string): string {
  const text = value.trim()
  if (text === '') throw new Error(`${name} must not be empty`)
  if (text.length > limit) throw new Error(`${name} must be at most ${limit} characters`)
  return text
}

function option(value: AgentTeamDecisionOption, at: string): AgentTeamDecisionOption {
  const label = bounded(value.label, DECISION_LABEL_LIMIT, `${at} label`)
  const description = value.description?.trim() ?? ''
  if (description.length > DECISION_DESCRIPTION_LIMIT) throw new Error(`${at} description must be at most ${DECISION_DESCRIPTION_LIMIT} characters`)
  return Object.freeze({ label, ...(description === '' ? {} : { description }) })
}

/** Trim and check the questions of a new card; the stored card is exactly what this returns. */
export function normalizeDecisionQuestions(questions: readonly AgentTeamDecisionQuestion[]): readonly AgentTeamDecisionQuestion[] {
  if (questions.length < 1 || questions.length > DECISION_MAX_QUESTIONS) throw new Error(`a decision card asks 1 to ${DECISION_MAX_QUESTIONS} questions`)
  return Object.freeze(questions.map((question, index) => {
    const at = `question ${index + 1}`
    const prompt = bounded(question.prompt, DECISION_PROMPT_LIMIT, `${at} prompt`)
    if (question.options.length < DECISION_MIN_OPTIONS || question.options.length > DECISION_MAX_OPTIONS) {
      throw new Error(`${at} needs ${DECISION_MIN_OPTIONS} to ${DECISION_MAX_OPTIONS} options`)
    }
    const options = question.options.map((entry, optionIndex) => option(entry, `${at} option ${optionIndex + 1}`))
    if (new Set(options.map(entry => entry.label.toLowerCase())).size !== options.length) throw new Error(`${at} has two options with the same label`)
    const recommended = [...new Set(question.recommended)].sort((left, right) => left - right)
    if (recommended.some(index => !Number.isSafeInteger(index) || index < 0 || index >= options.length)) throw new Error(`${at} recommends an option it does not have`)
    if (!question.multiple && recommended.length > 1) throw new Error(`${at} is single choice, so it recommends at most one option`)
    return Object.freeze({ prompt, multiple: question.multiple, options: Object.freeze(options), recommended: Object.freeze(recommended) })
  }))
}

export function normalizeDecisionContext(context: string | undefined): string | undefined {
  const text = context?.trim() ?? ''
  if (text.length > DECISION_CONTEXT_LIMIT) throw new Error(`context must be at most ${DECISION_CONTEXT_LIMIT} characters`)
  return text === '' ? undefined : text
}

/** Check one answer per question: a pick the question allows, free text, or both. */
export function normalizeDecisionAnswers(questions: readonly AgentTeamDecisionQuestion[], answers: readonly AgentTeamDecisionAnswer[]): readonly AgentTeamDecisionAnswer[] {
  if (answers.length !== questions.length) throw new Error(`answer each of the ${questions.length} question(s), in order`)
  return Object.freeze(answers.map((answer, index) => {
    const question = questions[index]!
    const at = `answer ${index + 1}`
    const selected = [...new Set(answer.selected)].sort((left, right) => left - right)
    if (selected.some(pick => !Number.isSafeInteger(pick) || pick < 0 || pick >= question.options.length)) throw new Error(`${at} picks an option the question does not have`)
    if (!question.multiple && selected.length > 1) throw new Error(`${at} picks more than one option on a single-choice question`)
    const text = answer.text?.trim() ?? ''
    if (text.length > DECISION_ANSWER_TEXT_LIMIT) throw new Error(`${at} text must be at most ${DECISION_ANSWER_TEXT_LIMIT} characters`)
    if (selected.length === 0 && text === '') throw new Error(`${at} needs a picked option or a written answer`)
    return Object.freeze({ selected: Object.freeze(selected), ...(text === '' ? {} : { text }) })
  }))
}

export function askedDecisionState(
  notice: AgentTeamDecisionNotice & { readonly event: 'asked' },
  where: { readonly channelRef: AgentTeamChannelRef; readonly threadRef: AgentTeamThreadRef; readonly messageRef: AgentTeamMessageRef },
  asker: AgentTeamMemberId,
  occurredAt: string,
): AgentTeamDecisionState {
  return Object.freeze({ decisionRef: notice.decisionRef, ...where, asker, ...(notice.context === undefined ? {} : { context: notice.context }),
    ...(notice.target === undefined ? {} : { target: notice.target }), questions: notice.questions, askedAt: occurredAt, status: 'open' as const })
}

/** Close an open card with an answer or a withdrawal. */
export function closedDecisionState(state: AgentTeamDecisionState, notice: AgentTeamDecisionNotice, actor: AgentTeamMemberId, occurredAt: string): AgentTeamDecisionState {
  if (notice.event === 'answered') return Object.freeze({ ...state, status: 'answered' as const, answers: notice.answers, closedBy: actor, closedAt: occurredAt })
  if (notice.event === 'withdrawn') return Object.freeze({ ...state, status: 'withdrawn' as const, closedBy: actor, closedAt: occurredAt })
  return state
}

export function decisionView(state: AgentTeamDecisionState, taskRef?: AgentTeamTaskRef): AgentTeamDecisionView {
  return Object.freeze({ ...state, ...(taskRef === undefined ? {} : { taskRef }) })
}

/**
 * One recorded decision as the issue view reads it. `supersedes` is the link
 * the ledger derives, never a stored field: the newest plan record on a Task
 * supersedes the plan record before it.
 */
export function decisionRecordView(state: AgentTeamDecisionRecordState, supersedes?: AgentTeamDecisionRecordRef): AgentTeamDecisionRecord {
  return Object.freeze({ ...state, ...(supersedes === undefined ? {} : { supersedes }) })
}

/**
 * A Task's current Owner decisions: the records another record replaced are
 * dropped, and the newest ones are kept, oldest first. `supersedes` is the
 * ledger's derived link, so "current" is one rule for every reader instead of
 * a second notion maintained next to the record list.
 */
export function currentDecisionRecords(records: readonly AgentTeamDecisionRecord[], limit = OWNER_DECISIONS_LIMIT): readonly AgentTeamDecisionRecord[] {
  const superseded = new Set(records.flatMap(record => record.supersedes === undefined ? [] : [record.supersedes]))
  return Object.freeze(records.filter(record => !superseded.has(record.recordRef)).slice(-limit))
}

/** The parts of one current decision a reader's one-line render needs. */
export interface OwnerDecisionLineSource {
  readonly recordRef: string
  readonly decided: string
  readonly rationale: string
}

/** One line per current decision, every line carrying its record ref. */
export function ownerDecisionLines(records: readonly OwnerDecisionLineSource[]): string[] {
  return records.map(record => {
    const rationale = record.rationale.replace(/\s+/g, ' ').trim()
    return `${record.recordRef} · ${record.decided}${rationale === '' ? '' : ` — because ${rationale}`}`
  })
}

/** The Host reads one Member's current Task decisions need; the Host service satisfies this. */
export interface OwnerDecisionsHost {
  memberForAgent(agent: Agent): { readonly memberId: AgentTeamMemberId } | undefined
  members(): readonly {
    readonly member: { readonly memberId: AgentTeamMemberId }
    readonly instances: readonly { readonly sessionId?: string | undefined; readonly threadRefs: readonly AgentTeamThreadRef[] }[]
  }[]
  workspacesForAgent(agent: Agent): readonly { readonly workspaceId: WorkspaceId }[]
  resolveThreadRefs(request: { readonly workspaceId: WorkspaceId; readonly threadRefs: readonly AgentTeamThreadRef[] }): {
    readonly resolved: readonly { readonly threadRef: AgentTeamThreadRef; readonly taskRef?: AgentTeamTaskRef | undefined }[]
  }
  decisionRecords(request: { readonly workspaceId: WorkspaceId; readonly taskRef: AgentTeamTaskRef }): {
    readonly records: readonly AgentTeamDecisionRecord[]
  }
}

/** The Task one Session is working in and its current Owner decisions. */
export interface OwnerDecisions {
  readonly taskRef: AgentTeamTaskRef
  readonly decisions: readonly AgentTeamDecisionRecord[]
}

/**
 * The current Owner decisions of the Task the Session is working in: the Task
 * of the Thread its instance slot is bound to, resolved through the Host's own
 * reads. Undefined when no Thread of this Session is bound to a Task, or when
 * the Session is not a live seat — the caller then injects nothing rather than
 * guessing a Task.
 */
export function ownerDecisionsForAgent(host: OwnerDecisionsHost, agent: Agent): OwnerDecisions | undefined {
  const member = host.memberForAgent(agent)
  if (member === undefined) return undefined
  const status = host.members().find(entry => entry.member.memberId === member.memberId)
  const instance = status?.instances.find(entry => entry.sessionId === agent.id) ?? status?.instances[0]
  const threadRef = instance?.threadRefs.at(-1)
  if (threadRef === undefined) return undefined
  for (const participation of host.workspacesForAgent(agent)) {
    const resolved = host.resolveThreadRefs({ workspaceId: participation.workspaceId, threadRefs: [threadRef] }).resolved[0]
    if (resolved === undefined) continue
    const taskRef = resolved.taskRef
    if (taskRef === undefined) return undefined
    const records = host.decisionRecords({ workspaceId: participation.workspaceId, taskRef }).records
    return Object.freeze({ taskRef, decisions: currentDecisionRecords(records) })
  }
  return undefined
}

/**
 * The one line a decision record carries: what was picked, or what was
 * written. The same composition runs at write time and when the ledger
 * derives a record from an operation written before decision records existed,
 * so a stored and a derived record of the same answer read alike.
 */
export function decisionSummary(questions: readonly AgentTeamDecisionQuestion[], answers: readonly AgentTeamDecisionAnswer[]): string {
  const parts = answers.flatMap((answer, index) => {
    const question = questions[index]
    const picks = answer.selected.map(pick => question?.options[pick]?.label ?? `option ${pick + 1}`)
    const text = answer.text?.trim() ?? ''
    if (picks.length === 0) return text === '' ? [] : [text]
    return text === '' ? [picks.join(', ')] : [`${picks.join(', ')} — ${text}`]
  })
  return parts.length === 0 ? 'answered' : parts.join('; ')
}

/** Why the Human decided, in their own words: the free text of every answer that carries any. */
export function decisionRationale(answers: readonly AgentTeamDecisionAnswer[]): string {
  return answers.map(answer => answer.text?.trim() ?? '').filter(text => text !== '').join('\n')
}

/** The one line a plan approval carries. */
export function planApprovalSummary(title: string): string {
  return `Approved plan "${title}"`
}

function letter(index: number): string {
  return String.fromCharCode(97 + index)
}

/** The plain-text card, for readers that do not render it: the Thread notice body and the asker's tool result. */
export function decisionQuestionsText(questions: readonly AgentTeamDecisionQuestion[]): string[] {
  return questions.flatMap((question, index) => [
    `${index + 1}. ${question.prompt} (${question.multiple ? 'pick any' : 'pick one'}, or answer in words)`,
    ...question.options.map((entry, optionIndex) => `   ${letter(optionIndex)}) ${entry.label}${entry.description === undefined ? '' : ` — ${entry.description}`}${question.recommended.includes(optionIndex) ? ' (recommended)' : ''}`),
  ])
}

/** One line per question naming what the Human picked or wrote. */
export function decisionAnswersText(questions: readonly AgentTeamDecisionQuestion[], answers: readonly AgentTeamDecisionAnswer[]): string[] {
  return answers.map((answer, index) => {
    const question = questions[index]!
    const picks = answer.selected.map(pick => question.options[pick]?.label ?? `option ${pick + 1}`)
    const parts = [...(picks.length === 0 ? [] : [picks.join(', ')]), ...(answer.text === undefined ? [] : [`"${answer.text}"`])]
    return `${index + 1}. ${question.prompt} → ${parts.join(' + ')}`
  })
}

/** The Thread notice an ask posts: it mentions the addressee, which puts the card in their Inbox. */
export function decisionAskBody(addresseeHandle: string, decisionRef: AgentTeamDecisionRef, context: string | undefined, questions: readonly AgentTeamDecisionQuestion[]): string {
  const count = questions.length
  return [
    `@${addresseeHandle} I need your call on ${count === 1 ? 'one question' : `${count} questions`} — ${decisionRef}.`,
    ...(context === undefined ? [] : [context]),
    ...decisionQuestionsText(questions),
  ].join('\n')
}

/** The Thread notice an answer posts: it mentions the asker, which wakes it with the answer. */
export function decisionAnswerBody(askerHandle: string, decisionRef: AgentTeamDecisionRef, questions: readonly AgentTeamDecisionQuestion[], answers: readonly AgentTeamDecisionAnswer[]): string {
  return [`@${askerHandle} Answered ${decisionRef}:`, ...decisionAnswersText(questions, answers)].join('\n')
}

export function decisionWithdrawBody(decisionRef: AgentTeamDecisionRef): string {
  return `Withdrew ${decisionRef}; it no longer needs an answer.`
}
