// Every GitHub write reports the same way: the Remote's own message when the
// Host rejected the call, else the one translated line. One helper, so a board
// drop, a field write and a comment all fail in the same words.

import type { TeamConversationProps } from '../slots.ts'

export function githubFailureText(error: unknown, t: TeamConversationProps['t']): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return t('githubWriteFailed')
}
