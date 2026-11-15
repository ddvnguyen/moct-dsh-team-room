// The words a running card uses for one step of a Turn.
//
// The Host sends the label only ("read issue-view.module.css"): the tool's own
// name plus at most one path's basename, never arguments or output. Turning
// that into a sentence is the Client's business, because the words are
// localized. The families are GitHub's — reading, searching, editing, running
// a command, checks, planning — and a tool outside them keeps its own name
// ("Calling fetch_url"), so a new tool reads as itself instead of as a wrong
// verb.

import type { ActivityStepSource } from '../multica/types.ts'
import type { TeamConversationProps } from '../slots.ts'

/** The order matters: the first family whose pattern matches names the step. */
const FAMILIES: readonly { readonly match: RegExp; readonly key: string }[] = [
  { match: /plan|todo|agenda/i, key: 'runStepPlanning' },
  { match: /read|open|view|inspect|show|cat\b/i, key: 'runStepReading' },
  { match: /grep|search|find|glob|list|ls\b|query|lookup/i, key: 'runStepSearching' },
  { match: /test|lint|check|build|typecheck|verify/i, key: 'runStepChecking' },
  { match: /edit|write|apply|patch|replace|create|mkdir|move|rename|delete|rm\b/i, key: 'runStepEditing' },
  { match: /shell|bash|zsh|sh\b|pwsh|powershell|exec|command|terminal|run|spawn/i, key: 'runStepRunning' },
]

/**
 * What the step names beyond its tool: the basename `activityLabel` kept, or
 * the empty string when the label is the tool's name alone (a shell call, or a
 * call whose argument was dropped as credential-shaped).
 */
export function stepTarget(step: ActivityStepSource): string {
  return step.label.startsWith(step.tool) ? step.label.slice(step.tool.length).trim() : ''
}

/**
 * One step as a sentence: the family's verb plus the target when there is one
 * ("Reading file.ts"), and the tool's own name when no family knows it
 * ("Calling fetch_url").
 */
export function runStepPhrase(step: ActivityStepSource, t: TeamConversationProps['t']): string {
  const family = FAMILIES.find(candidate => candidate.match.test(step.tool))
  const target = stepTarget(step)
  if (family === undefined) {
    return target === ''
      ? t('runStepCalling', { tool: step.tool })
      : `${t('runStepWorking')} ${target}`
  }
  const verb = t(family.key as Parameters<typeof t>[0])
  return target === '' ? verb : `${verb} ${target}`
}

/**
 * The card's lines, newest first. The newest step reads as "Now …" because the
 * card is asking what the Agent is doing at this instant; the ones before it
 * are the Turn's recent shape and read as plain steps. No steps yet is the
 * honest sentence: the Turn is running and has not called anything.
 */
export function runStepLines(
  steps: readonly ActivityStepSource[] | undefined,
  t: TeamConversationProps['t'],
): readonly string[] {
  if (steps === undefined || steps.length === 0) return [t('runStepNowThinking')]
  const newestFirst = [...steps].reverse()
  return newestFirst.map((step, index) => index === 0
    ? t('runStepNow', { phrase: runStepPhrase(step, t) })
    : runStepPhrase(step, t))
}
