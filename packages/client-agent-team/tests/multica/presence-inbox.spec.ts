// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildPresenceMap, deriveAgentPresence, deriveAvailability, deriveWorkload } from '../../src/client/multica/derive-presence.ts'
import { filterInboxItems, groupInboxBySeverity, inboxFilterCount, EMPTY_INBOX_FILTERS } from '../../src/client/multica/inbox-filter.ts'
import { makeTimeAgo } from '../../src/client/multica/time-ago.ts'
import { cacheHitPercent, formatDuration, runDurationMs } from '../../src/client/multica/task-run-labels.ts'
import type { ActivitySource, InboxItem, PresenceSource } from '../../src/client/multica/types.ts'

function seat(overrides: Partial<PresenceSource> = {}): PresenceSource {
  return {
    availability: 'active',
    presence: 'available',
    instances: [{ presence: 'available' }],
    member: { role: 'worker', instances: 2 },
    ...overrides,
  }
}

function activity(overrides: Partial<ActivitySource> & Pick<ActivitySource, 'memberId'>): ActivitySource {
  return {
    handle: '@worker',
    turnStartedAt: '2026-10-18T00:00:00.000Z',
    stepCount: 3,
    toolCount: 2,
    updatedAt: '2026-10-18T00:01:00.000Z',
    ...overrides,
  }
}

describe('multica presence derivation', () => {
  it('collapses lifecycle status into availability', () => {
    expect(deriveAvailability(seat({ availability: 'archived' }))).toBe('archived')
    expect(deriveAvailability(seat({ availability: 'suspended' }))).toBe('offline')
    expect(deriveAvailability(seat({ presence: 'error' }))).toBe('unstable')
    expect(deriveAvailability(seat())).toBe('online')
  })

  it('classifies workload from running counts', () => {
    expect(deriveWorkload({ runningCount: 1, queuedCount: 0 })).toBe('working')
    expect(deriveWorkload({ runningCount: 0, queuedCount: 2 })).toBe('queued')
    expect(deriveWorkload({ runningCount: 0, queuedCount: 0 })).toBe('idle')
  })

  it('counts a live activity even when instance presence lags', () => {
    const detail = deriveAgentPresence({
      status: seat({ presence: 'available', instances: [{ presence: 'available' }] }),
      activities: [activity({ memberId: 'm1' })],
    })
    expect(detail.workload).toBe('working')
    expect(detail.runningCount).toBe(1)
    expect(detail.capacity).toBe(2)
  })

  it('keeps an archived seat idle whatever its activity says', () => {
    const detail = deriveAgentPresence({
      status: seat({ availability: 'archived' }),
      activities: [activity({ memberId: 'm1' })],
    })
    expect(detail).toMatchObject({ availability: 'archived', workload: 'idle', runningCount: 0 })
  })

  it('builds a map for the whole roster', () => {
    const map = buildPresenceMap({
      members: [seat(), seat({ availability: 'suspended' })],
      memberIds: ['m1', 'm2'],
      activities: [activity({ memberId: 'm1' })],
    })
    expect(map.get('m1')?.workload).toBe('working')
    expect(map.get('m2')?.availability).toBe('offline')
  })
})

describe('multica inbox filters', () => {
  const items: InboxItem[] = [
    { id: '1', severity: 'action_required', title: 'Decision', reason: 'decision', read: false, updatedAt: '2026-10-18T00:00:00Z', status: 'in_review', priority: 'high', actorId: 'm1', channelRef: 'c1' },
    { id: '2', severity: 'attention', title: 'Mention', reason: 'mention', read: false, updatedAt: '2026-10-18T00:00:00Z', status: 'todo', priority: 'none', actorId: 'm2', channelRef: 'c1' },
    { id: '3', severity: 'info', title: 'Activity', reason: 'activity', read: true, updatedAt: '2026-10-18T00:00:00Z', status: 'done', priority: 'low', actorId: 'm1', channelRef: 'c2' },
  ]

  it('is a no-op with no filters', () => {
    expect(filterInboxItems(items, EMPTY_INBOX_FILTERS)).toHaveLength(3)
    expect(inboxFilterCount(EMPTY_INBOX_FILTERS)).toBe(0)
  })

  it('filters by severity, actor, channel and unread', () => {
    expect(filterInboxItems(items, { ...EMPTY_INBOX_FILTERS, severities: ['action_required'] }).map(i => i.id)).toEqual(['1'])
    expect(filterInboxItems(items, { ...EMPTY_INBOX_FILTERS, actors: ['m1'] }).map(i => i.id)).toEqual(['1', '3'])
    expect(filterInboxItems(items, { ...EMPTY_INBOX_FILTERS, channels: ['c2'] }).map(i => i.id)).toEqual(['3'])
    expect(filterInboxItems(items, { ...EMPTY_INBOX_FILTERS, unreadOnly: true }).map(i => i.id)).toEqual(['1', '2'])
    expect(inboxFilterCount({ ...EMPTY_INBOX_FILTERS, severities: ['info'], unreadOnly: true })).toBe(2)
  })

  it('groups by severity in interrupting order', () => {
    const groups = groupInboxBySeverity(items)
    expect(groups.action_required.map(i => i.id)).toEqual(['1'])
    expect(groups.attention.map(i => i.id)).toEqual(['2'])
    expect(groups.info.map(i => i.id)).toEqual(['3'])
  })
})

describe('multica time and run labels', () => {
  it('formats relative time through the caller templates', () => {
    const timeAgo = makeTimeAgo({ justNow: 'now', minutesAgo: '{count}m', hoursAgo: '{count}h', daysAgo: '{count}d' })
    const now = Date.parse('2026-10-18T12:00:00Z')
    expect(timeAgo('2026-10-18T11:59:40Z', now)).toBe('now')
    expect(timeAgo('2026-10-18T11:30:00Z', now)).toBe('30m')
    expect(timeAgo('2026-10-18T09:00:00Z', now)).toBe('3h')
    expect(timeAgo('2026-10-16T12:00:00Z', now)).toBe('2d')
  })

  it('computes run duration only for finished runs', () => {
    expect(runDurationMs({ startedAt: '2026-10-18T00:00:00Z', endedAt: '2026-10-18T00:01:00Z' })).toBe(60_000)
    expect(runDurationMs({ startedAt: '2026-10-18T00:00:00Z', running: true })).toBeNull()
    expect(formatDuration(64_000)).toBe('1m 04s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
  })

  it('computes cache-hit share over every input bucket', () => {
    expect(cacheHitPercent({ tokensIn: 500, cacheReadTokens: 500, cacheWriteTokens: 0 })).toBe(50)
    expect(cacheHitPercent({ tokensIn: 500, cacheReadTokens: null })).toBeNull()
  })
})
