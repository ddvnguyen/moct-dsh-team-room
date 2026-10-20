// The data half of the Multica-style Inbox: the Host's Inbox projection, the
// #109 decision cards and the Thread Turn failures joined into one row model,
// with the severity the issue's data mapping defines:
//
// - `action_required` — a pending decision card, or the Task sitting in
//   review waiting on the Human's accept.
// - `attention` — the Thread named the reader (every mention, including a
//   decision ask and a confirmation-required one), or a Turn failed on it.
// - `info` — other unread activity.
//
// The decision ask itself mentions the Human (that is what puts the card in
// the Inbox), so the mention rule is checked after the decision rule: the
// same row must not sit in two groups. Read is the Host's own verdict — the
// unread queue holds it, the 「最近活跃」 tail does not — so nothing here
// re-derives it and no new store is added.

import type { AgentTeamDecisionView, AgentTeamInboxItem, AgentTeamThreadTurnFailure } from '@ddvnguyen/moct-dsh-team-room/types'
import type { InboxItem, InboxSeverity, TaskPriority, TaskStatus } from '../multica/types.ts'

/** Why one row sits where it sits; the row and the detail pane print it. */
export type InboxReason = 'decision' | 'review' | 'mention' | 'failedTurn' | 'activity'

/** Severity and reason of one unread row, in the mapping above. */
export function severityOf(item: AgentTeamInboxItem, decision: AgentTeamDecisionView | undefined, failures: readonly AgentTeamThreadTurnFailure[]): { readonly severity: InboxSeverity; readonly reason: InboxReason } {
  if (decision?.status === 'open') return { severity: 'action_required', reason: 'decision' }
  if (item.task?.status === 'in_review') return { severity: 'action_required', reason: 'review' }
  if (item.directCount > 0) return { severity: 'attention', reason: 'mention' }
  if (failures.length > 0) return { severity: 'attention', reason: 'failedTurn' }
  return { severity: 'info', reason: 'activity' }
}

/** The severity a derived reason implies; the two never drift apart. */
export function severityOfReason(reason: InboxReason): InboxSeverity {
  return reason === 'decision' || reason === 'review' ? 'action_required' : reason === 'activity' ? 'info' : 'attention'
}

/**
 * One Inbox row as the restyled page renders it: the Host's projection plus
 * the two facts the severity derivation reads on the side — the Thread's open
 * decision card (#109) and its failed-Turn notices.
 */
export interface InboxRow {
  /** Stable across refreshes: the Workspace id and the Thread ref. */
  readonly key: string
  readonly workspaceId: AgentTeamInboxItem['workspaceId']
  readonly workspaceTitle: string
  readonly item: AgentTeamInboxItem
  /** The row's open decision card, when the Thread holds one the Human must answer. */
  readonly decision: AgentTeamDecisionView | undefined
  /** Failed Turns on the Thread, newest last, as the notices report them. */
  readonly failures: readonly AgentTeamThreadTurnFailure[]
  readonly severity: InboxSeverity
  /** Why the row is in the queue, as the derivation found it. */
  readonly reason: InboxReason
}

/**
 * One row per Inbox slice entry, joined with the side reads the page holds.
 * The queue rows carry the derived severity; the 「最近活跃」 tail is read by
 * definition — it is a way back into work, not work waiting — so it stays in
 * the `info` band with no reason of its own and no unread marker to clear.
 */
export function buildInboxRow(workspaceId: AgentTeamInboxItem['workspaceId'], workspaceTitle: string, item: AgentTeamInboxItem, decision: AgentTeamDecisionView | undefined, failures: readonly AgentTeamThreadTurnFailure[]): InboxRow {
  const unread = item.unreadCount > 0
  const derived = unread ? severityOf(item, decision, failures) : { severity: 'info' as const, reason: 'activity' as const }
  return {
    key: `${workspaceId} ${item.thread.threadRef}`,
    workspaceId,
    workspaceTitle,
    item,
    decision,
    failures,
    severity: derived.severity,
    reason: unread ? derived.reason : 'activity',
  }
}

/**
 * The filterable facet of one row: the local `InboxItem` shape the ported
 * filter helpers (`multica/inbox-filter.ts`) operate on.
 */
export function facetOf(row: InboxRow): InboxItem {
  return {
    id: row.key,
    severity: row.severity,
    threadRef: row.item.thread.threadRef,
    ...(row.item.task === undefined ? {} : { taskRef: row.item.task.taskRef }),
    channelRef: row.item.channelRef,
    title: row.item.previewText ?? row.item.thread.threadRef,
    reason: row.reason,
    actorId: row.item.newestActor.memberId,
    status: row.item.task?.status ?? null,
    priority: row.item.task?.priority ?? null,
    read: row.item.unreadCount === 0,
    updatedAt: row.item.newestOccurredAt,
  }
}

/** The severity each row lands in, joined with its facet for the list. */
export interface FacetedRow {
  readonly row: InboxRow
  readonly facet: InboxItem
}

/**
 * Both slices as one faceted list: queue rows in the Host's own order, tail
 * rows after them. The list renders from this and the filters read the
 * facets, so a severity group and a filter can never disagree about where a
 * row belongs.
 */
export function buildFacetedRows(queue: readonly InboxRow[], recent: readonly InboxRow[]): readonly FacetedRow[] {
  return [...queue, ...recent].map(row => ({ row, facet: facetOf(row) }))
}

/** Channels present on the rows, for the filter menu's channel facet. */
export function inboxChannelOptions(rows: readonly InboxRow[]): readonly { readonly channelRef: string; readonly name: string; readonly count: number }[] {
  const counts = new Map<string, { readonly name: string; readonly count: number }>()
  for (const row of rows) {
    const name = row.item.channelName ?? row.item.channelRef
    const known = counts.get(row.item.channelRef)
    counts.set(row.item.channelRef, { name, count: (known?.count ?? 0) + 1 })
  }
  return [...counts.entries()].map(([channelRef, entry]) => ({ channelRef, name: entry.name, count: entry.count }))
}

/** Actors present on the rows, for the filter menu's agent facet, name-sorted. */
export function inboxActorOptions(rows: readonly InboxRow[]): readonly { readonly actorId: string; readonly name: string; readonly count: number }[] {
  const counts = new Map<string, { readonly name: string; readonly count: number }>()
  for (const row of rows) {
    const known = counts.get(row.item.newestActor.memberId)
    counts.set(row.item.newestActor.memberId, { name: row.item.newestActor.name, count: (known?.count ?? 0) + 1 })
  }
  return [...counts.entries()]
    .map(([actorId, entry]) => ({ actorId, name: entry.name, count: entry.count }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export type { TaskPriority, TaskStatus }
