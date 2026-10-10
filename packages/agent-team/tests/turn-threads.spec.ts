/** threadRefsForTurn: delivered and replied Threads union, window-bounded, deduplicated, empty when neither. */
import { describe, expect, it } from 'vitest'
import type { AgentTeamThreadRef } from '../src/types.ts'
import { threadRefsForTurn } from '../src/turn-threads.ts'

const t = (name: string) => `thread:${name}` as AgentTeamThreadRef

describe('threadRefsForTurn', () => {
  it('unions delivered and in-window replied Threads, deduplicated, delivered first', () => {
    const refs = threadRefsForTurn(
      [t('a'), t('b')],
      [{ sequence: 12, threadRef: t('c') }, { sequence: 10, threadRef: t('b') }, { sequence: 20, threadRef: t('out') }],
      { startSequence: 10, endSequence: 15 },
    )
    expect(refs).toEqual([t('a'), t('b'), t('c')])
  })

  it('records no thread when neither list has an entry', () => {
    expect(threadRefsForTurn([], [{ sequence: 1, threadRef: t('x') }], { startSequence: 5, endSequence: 9 })).toEqual([])
  })

  it('keeps the window edges inclusive', () => {
    expect(threadRefsForTurn([], [{ sequence: 5, threadRef: t('lo') }, { sequence: 9, threadRef: t('hi') }], { startSequence: 5, endSequence: 9 }))
      .toEqual([t('lo'), t('hi')])
  })
})
