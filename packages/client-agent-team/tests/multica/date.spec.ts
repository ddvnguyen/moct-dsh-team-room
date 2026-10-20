// @vitest-environment node
// Derived from multica-x packages/core/issues/date.test.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.

import { describe, expect, it } from 'vitest'
import {
  addDaysDateOnly,
  dateOnlyToLocalDate,
  dateOnlyToUTCDate,
  formatDateOnly,
  isPastDateOnly,
  toDateOnly,
  todayDateOnly,
} from '../../src/client/multica/date.ts'

describe('date-only helpers', () => {
  it('serializes a picked local day to YYYY-MM-DD with the local calendar', () => {
    expect(toDateOnly(new Date(2026, 2, 1))).toBe('2026-03-01')
    expect(toDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('formats a date-only string without shifting the day', () => {
    expect(formatDateOnly('2026-03-01', { month: 'short', day: 'numeric' }, 'en-US')).toBe('Mar 1')
    expect(formatDateOnly('2026-03-01', undefined, 'en-US')).toBe('Mar 1')
    expect(formatDateOnly(null)).toBe('')
    expect(formatDateOnly('')).toBe('')
  })

  it('round-trips a picked day back to the same displayed day', () => {
    const stored = toDateOnly(new Date(2026, 2, 1))
    expect(stored).toBe('2026-03-01')
    expect(formatDateOnly(stored, { month: 'short', day: 'numeric' }, 'en-US')).toBe('Mar 1')
  })

  it('anchors a date-only value at UTC midnight', () => {
    expect(dateOnlyToUTCDate('2026-03-01')?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(dateOnlyToUTCDate(null)).toBeNull()
  })

  it('tolerates a legacy RFC3339 instant by reading its UTC day', () => {
    expect(dateOnlyToUTCDate('2026-02-28T16:00:00Z')?.toISOString()).toBe('2026-02-28T00:00:00.000Z')
  })

  it('builds a local-midnight Date for a selected day', () => {
    const date = dateOnlyToLocalDate('2026-03-01')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(2)
    expect(date?.getDate()).toBe(1)
    expect(dateOnlyToLocalDate(null)).toBeUndefined()
  })

  it('detects past calendar days relative to today', () => {
    expect(isPastDateOnly(addDaysDateOnly(-1))).toBe(true)
    expect(isPastDateOnly(todayDateOnly())).toBe(false)
    expect(isPastDateOnly(addDaysDateOnly(1))).toBe(false)
    expect(isPastDateOnly(null)).toBe(false)
  })
})
