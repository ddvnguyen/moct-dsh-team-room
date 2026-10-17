// Derived from multica-x packages/core/issues/config/priority.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.

import type { TaskPriority } from './types.ts'

/**
 * Severity order, high to low. This is the sort rank — "none" must stay last.
 * Never reorder this to change how a menu reads; use `PRIORITY_DISPLAY_ORDER`.
 */
export const PRIORITY_ORDER: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low', 'none']

/**
 * Order every user-facing priority list renders in: the empty value first,
 * then severity descending — the first row is always "clear this field".
 */
export const PRIORITY_DISPLAY_ORDER: readonly TaskPriority[] = ['none', 'urgent', 'high', 'medium', 'low']

export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = Object.fromEntries(
  PRIORITY_ORDER.map((priority, index) => [priority, index]),
) as Readonly<Record<TaskPriority, number>>

/** Bars drawn by `PriorityIcon`; 0 means the empty glyph. */
export const PRIORITY_BARS: Readonly<Record<TaskPriority, number>> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
}

export const PRIORITY_LABEL_KEY = {
  urgent: 'priorityUrgent',
  high: 'priorityHigh',
  medium: 'priorityMedium',
  low: 'priorityLow',
  none: 'priorityNone',
} as const satisfies Readonly<Record<TaskPriority, string>>

export function isTaskPriority(value: string): value is TaskPriority {
  return (PRIORITY_ORDER as readonly string[]).includes(value)
}

/** Absent reads as `none` everywhere, including on old ledgers. */
export function normalizePriority(value: TaskPriority | undefined | null): TaskPriority {
  return value ?? 'none'
}
