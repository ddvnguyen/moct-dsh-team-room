// Derived from multica-x packages/core/issues/config/status.ts and packages/core/issues/status-category.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Multica keys its columns on the concrete status; the Team ledger derives
// exactly five, so the catalog surface collapses to a fixed order. Categories
// stay separate because behaviour (accept/close/reopen) is category-driven.

import type { StatusCategory, TaskStatus } from './types.ts'

/** Board column order, left to right. */
export const STATUS_ORDER: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'closed']

/** The four lifecycle categories, in board order. */
export const STATUS_CATEGORY_ORDER: readonly StatusCategory[] = ['unstarted', 'started', 'done', 'closed']

export const STATUS_CATEGORY: Readonly<Record<TaskStatus, StatusCategory>> = {
  todo: 'unstarted',
  in_progress: 'started',
  in_review: 'started',
  done: 'done',
  closed: 'closed',
}

/** Display keys are resolved through `locales.ts`; this map is the stable id. */
export const STATUS_LABEL_KEY = {
  todo: 'statusTodo',
  in_progress: 'statusInProgress',
  in_review: 'statusInReview',
  done: 'statusDone',
  closed: 'statusClosed',
} as const satisfies Readonly<Record<TaskStatus, string>>

export function isTaskStatus(value: string): value is TaskStatus {
  return (STATUS_ORDER as readonly string[]).includes(value)
}

export function statusCategoryOf(status: TaskStatus): StatusCategory {
  return STATUS_CATEGORY[status]
}

/** Human-driven targets: a card may be dragged to these; claims drive the rest. */
export const HUMAN_STATUS_TARGETS: readonly TaskStatus[] = ['todo', 'done', 'closed']

export function isHumanStatusTarget(status: TaskStatus): boolean {
  return HUMAN_STATUS_TARGETS.includes(status)
}

/** Terminal statuses never move again through a claim. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'closed'
}

/** Column rank, used by the ported status sort. */
export const STATUS_RANK: Readonly<Record<TaskStatus, number>> = Object.fromEntries(
  STATUS_ORDER.map((status, index) => [status, index]),
) as Readonly<Record<TaskStatus, number>>
