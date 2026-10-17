// Derived from multica-x packages/core/inbox/filter-store.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Only the two pure functions are ported (no zustand store): the Team inbox
// keeps its state in the existing attention/watermark projections.

import type { InboxItem, InboxSeverity, TaskPriority, TaskStatus } from './types.ts'

export interface InboxFilters {
  readonly severities: readonly InboxSeverity[]
  readonly statuses: readonly TaskStatus[]
  readonly priorities: readonly TaskPriority[]
  readonly actors: readonly string[]
  readonly channels: readonly string[]
  readonly unreadOnly: boolean
}

export const EMPTY_INBOX_FILTERS: InboxFilters = {
  severities: [],
  statuses: [],
  priorities: [],
  actors: [],
  channels: [],
  unreadOnly: false,
}

export function isEmptyInboxFilters(filters: InboxFilters): boolean {
  return filters.severities.length === 0
    && filters.statuses.length === 0
    && filters.priorities.length === 0
    && filters.actors.length === 0
    && filters.channels.length === 0
    && !filters.unreadOnly
}

/** OR within one facet, AND across facets. An empty facet is "no filter". */
export function filterInboxItems(items: readonly InboxItem[], filters: InboxFilters): InboxItem[] {
  if (isEmptyInboxFilters(filters)) return [...items]
  const severities = new Set(filters.severities)
  const statuses = new Set(filters.statuses)
  const priorities = new Set(filters.priorities)
  const actors = new Set(filters.actors)
  const channels = new Set(filters.channels)
  return items.filter(item => (
    (severities.size === 0 || severities.has(item.severity))
    && (statuses.size === 0 || (item.status != null && statuses.has(item.status)))
    && (priorities.size === 0 || (item.priority != null && priorities.has(item.priority)))
    && (actors.size === 0 || (item.actorId != null && actors.has(item.actorId)))
    && (channels.size === 0 || (item.channelRef != null && channels.has(item.channelRef)))
    && (!filters.unreadOnly || !item.read)
  ))
}

export function inboxFilterCount(filters: InboxFilters): number {
  return filters.severities.length
    + filters.statuses.length
    + filters.priorities.length
    + filters.actors.length
    + filters.channels.length
    + (filters.unreadOnly ? 1 : 0)
}

/** Severity group order: the only one that must interrupt comes first. */
export const INBOX_SEVERITY_ORDER: readonly InboxSeverity[] = ['action_required', 'attention', 'info']

export function groupInboxBySeverity(items: readonly InboxItem[]): Record<InboxSeverity, InboxItem[]> {
  const groups: Record<InboxSeverity, InboxItem[]> = { action_required: [], attention: [], info: [] }
  for (const item of items) groups[item.severity].push(item)
  return groups
}
