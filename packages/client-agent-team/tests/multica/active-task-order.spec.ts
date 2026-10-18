// @vitest-environment node
// Derived from multica-x packages/views/issues/components/active-task-order.test.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.

import { describe, expect, it } from 'vitest'
import { compareActiveRuns, type OrderedRun } from '../../src/client/multica/active-task-order.ts'

const run = (sessionId: string, state: 'running' | 'queued' | 'finished', startedAt = '2026-09-08T03:00:00Z'): OrderedRun => ({
  sessionId,
  running: state === 'running',
  queued: state === 'queued',
  startedAt,
  memberId: 'member:builder',
})
const ids = (runs: OrderedRun[]) => runs.toSorted(compareActiveRuns).map(entry => entry.sessionId)

describe('active run display order', () => {
  it('shows running work ahead of queued work ahead of history', () => {
    expect(ids([run('done', 'finished'), run('queued', 'queued'), run('running', 'running')]))
      .toEqual(['running', 'queued', 'done'])
  })

  it('orders ties by start time, oldest first, then by id', () => {
    expect(ids([
      run('new', 'queued', '2026-09-08T04:00:00Z'),
      run('old-b', 'queued'),
      run('old-a', 'queued'),
    ])).toEqual(['old-a', 'old-b', 'new'])
  })

  it('compares instants rather than timezone strings', () => {
    expect(ids([
      run('later', 'queued', '2026-09-08T03:01:00Z'),
      run('earlier', 'queued', '2026-09-08T11:00:00+08:00'),
    ])).toEqual(['earlier', 'later'])
  })

  it('falls back to id order when a start time does not parse', () => {
    expect(ids([run('b', 'queued', 'not a date'), run('a', 'queued', 'also not')])).toEqual(['a', 'b'])
  })
})
