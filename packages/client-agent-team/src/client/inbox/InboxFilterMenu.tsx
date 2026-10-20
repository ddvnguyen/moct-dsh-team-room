// Derived from multica-x packages/views/inbox/components/inbox-filter-menu.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's nested dropdown submenus become one flat menu —
// the Team inbox filters at most a queue page, so a submenu per facet spends
// clicks the flat rows do not — and the Radix dropdown becomes the seat's own
// PickerMenu shell. The filter state itself is the page's, not a store: the
// facet rows call back with toggles and the pure helpers in
// `multica/inbox-filter.ts` do the matching.

import { useMemo } from 'react'
import { PickerItem, PickerMenu } from '../multica-ui/index.ts'
import type { TeamConversationProps } from '../slots.ts'
import { filterInboxItems, inboxFilterCount, type InboxFilters } from '../multica/inbox-filter.ts'
import { INBOX_SEVERITY_KEYS } from './inbox-display.ts'
import type { FacetedRow } from './inbox-items.ts'
import css from './inbox.module.css'

export interface InboxFilterMenuProps {
  readonly rows: readonly FacetedRow[]
  readonly filters: InboxFilters
  readonly onToggle: (change: (filters: InboxFilters) => InboxFilters) => void
  readonly onClear: () => void
  readonly channels: readonly { readonly channelRef: string; readonly name: string; readonly count: number }[]
  readonly actors: readonly { readonly actorId: string; readonly name: string; readonly count: number }[]
  readonly t: TeamConversationProps['t']
}

const SEVERITIES = ['action_required', 'attention', 'info'] as const

/**
 * The queue's faceted filters: unread, severity, channel and agent, each with
 * the count that facet can actually reveal — every count respects the other
 * active dimensions while ignoring its own, the same rule Multica's menu
 * speaks, computed here with the same `filterInboxItems` the list filters by.
 */
export function InboxFilterMenu({ rows, filters, onToggle, onClear, channels, actors, t }: InboxFilterMenuProps) {
  const facets = useMemo(() => rows.map(entry => entry.facet), [rows])
  // Facet counts: clear the facet's own dimension, keep the others.
  // The severity facet counts the queue only: the bands are what waits of the
  // reader, and a read row has no band to be counted in — counting it would
  // promise a row the list never shows.
  const severityCounts = useMemo(() => {
    const items = filterInboxItems(facets.filter(facet => !facet.read), { ...filters, severities: [] })
    return countBy(items, item => item.severity)
  }, [facets, filters])
  const channelCounts = useMemo(() => {
    const items = filterInboxItems(facets, { ...filters, channels: [] })
    return countBy(items, item => item.channelRef ?? '')
  }, [facets, filters])
  const actorCounts = useMemo(() => {
    const items = filterInboxItems(facets, { ...filters, actors: [] })
    return countBy(items, item => item.actorId ?? '')
  }, [facets, filters])
  const unreadCount = useMemo(() => {
    const items = filterInboxItems(facets, { ...filters, unreadOnly: false })
    return items.filter(item => !item.read).length
  }, [facets, filters])
  const activeCount = inboxFilterCount(filters)
  const toggleSeverity = (severity: (typeof SEVERITIES)[number]): void => {
    onToggle(current => ({
      ...current,
      severities: current.severities.includes(severity)
        ? current.severities.filter(entry => entry !== severity)
        : [...current.severities, severity],
    }))
  }
  const toggleChannel = (channelRef: string): void => {
    onToggle(current => ({
      ...current,
      channels: current.channels.includes(channelRef)
        ? current.channels.filter(entry => entry !== channelRef)
        : [...current.channels, channelRef],
    }))
  }
  const toggleActor = (actorId: string): void => {
    onToggle(current => ({
      ...current,
      actors: current.actors.includes(actorId)
        ? current.actors.filter(entry => entry !== actorId)
        : [...current.actors, actorId],
    }))
  }
  const toggleUnread = (): void => {
    onToggle(current => ({ ...current, unreadOnly: !current.unreadOnly }))
  }
  return <PickerMenu
    label={activeCount > 0 ? String(activeCount) : t('inboxFilterTitle')}
    triggerLabel={activeCount > 0 ? t('inboxFilterActive', { count: activeCount }) : t('inboxFilterTitle')}
  >
    {close => <>
      <PickerItem selected={filters.unreadOnly} onSelect={toggleUnread}>
        <span className={css.filterRow}>{t('inboxFilterUnread')}{unreadCount > 0 && <span className={css.filterCount}>{unreadCount}</span>}</span>
      </PickerItem>
      <div className={css.filterSection} role="presentation">{t('inboxFilterSeverity')}</div>
      {SEVERITIES.map(severity => <PickerItem
        key={severity}
        selected={filters.severities.includes(severity)}
        onSelect={() => { toggleSeverity(severity) }}
      >
        <span className={css.filterRow}>
          {t(INBOX_SEVERITY_KEYS[severity])}
          {(severityCounts.get(severity) ?? 0) > 0 && <span className={css.filterCount}>{severityCounts.get(severity)}</span>}
        </span>
      </PickerItem>)}
      {channels.length > 0 && <div className={css.filterSection} role="presentation">{t('inboxFilterChannel')}</div>}
      {channels.map(channel => <PickerItem
        key={channel.channelRef}
        selected={filters.channels.includes(channel.channelRef)}
        onSelect={() => { toggleChannel(channel.channelRef) }}
      >
        <span className={css.filterRow}>
          #{channel.name}
          {(channelCounts.get(channel.channelRef) ?? 0) > 0 && <span className={css.filterCount}>{channelCounts.get(channel.channelRef)}</span>}
        </span>
      </PickerItem>)}
      {actors.length > 0 && <div className={css.filterSection} role="presentation">{t('inboxFilterAgent')}</div>}
      {actors.map(actor => <PickerItem
        key={actor.actorId}
        selected={filters.actors.includes(actor.actorId)}
        onSelect={() => { toggleActor(actor.actorId) }}
      >
        <span className={css.filterRow}>
          @{actor.name}
          {(actorCounts.get(actor.actorId) ?? 0) > 0 && <span className={css.filterCount}>{actorCounts.get(actor.actorId)}</span>}
        </span>
      </PickerItem>)}
      {activeCount > 0 && <PickerItem selected={false} onSelect={() => { onClear(); close() }}>
        <span className={css.filterRow}>{t('inboxFilterClear')}</span>
      </PickerItem>}
    </>}
  </PickerMenu>
}

/** One facet value's visible count, keyed by whatever the facet groups by. */
function countBy(items: readonly { readonly severity: string; readonly channelRef?: string | null | undefined; readonly actorId?: string | null | undefined }[], key: (item: { readonly severity: string; readonly channelRef?: string | null | undefined; readonly actorId?: string | null | undefined }) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const at = key(item)
    counts.set(at, (counts.get(at) ?? 0) + 1)
  }
  return counts
}
