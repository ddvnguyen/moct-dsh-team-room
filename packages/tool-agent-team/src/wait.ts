/**
 * The bounded wait a Team tool takes for the Human after asking: a decision
 * card's answer, or a Doc's verdict. Ten minutes is the default and the cap
 * until the Human's own status can tell a Member whether they are around.
 */

import type { AgentTeamDecisionView } from '@ddvnguyen/moct-dsh-team-room/types'
import { decisionAnswersText } from '@ddvnguyen/moct-dsh-team-room/host'

export const WAIT_MINUTES_DEFAULT = 10
export const WAIT_MINUTES_MAX = 10

/** The minutes to wait: the default when omitted, else a whole number from 0 to the cap. */
export function waitMinutesOf(value: unknown): number {
  if (value === undefined) return WAIT_MINUTES_DEFAULT
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > WAIT_MINUTES_MAX) {
    throw new Error(`waitMinutes must be a number from 0 to ${WAIT_MINUTES_MAX}`)
  }
  return Math.round(value)
}

/** One line per question naming what the Human picked or wrote. */
export function answerLines(view: AgentTeamDecisionView): string[] {
  return view.answers === undefined ? [] : decisionAnswersText(view.questions, view.answers)
}
