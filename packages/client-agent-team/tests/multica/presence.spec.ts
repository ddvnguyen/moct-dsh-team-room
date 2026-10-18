// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildPresenceMap, deriveAgentPresence, deriveAvailability, deriveWorkload } from '../../src/client/multica/derive-presence.ts'
import { AVAILABILITY_LABEL_KEY, AVAILABILITY_ORDER, WORKLOAD_LABEL_KEY, WORKLOAD_ORDER, availabilityTone, workloadTone } from '../../src/client/multica/presence.ts'
import type { ActivitySource, PresenceSource } from '../../src/client/multica/types.ts'

function seat(overrides: Partial<PresenceSource> = {}): PresenceSource {
  return {
    member: { memberId: 'member:builder', instances: 2 },
    availability: 'active',
    presence: 'available',
    instances: [],
    ...overrides,
  } as PresenceSource
}

function activity(memberId: string): ActivitySource {
  return { memberId } as ActivitySource
}

describe('presence derivation', () => {
  it('maps lifecycle status and instance presence to availability', () => {
    expect(deriveAvailability(seat())).toBe('online')
    expect(deriveAvailability(seat({ availability: 'suspended' }))).toBe('offline')
    expect(deriveAvailability(seat({ availability: 'unavailable' }))).toBe('offline')
    expect(deriveAvailability(seat({ availability: 'archived' }))).toBe('archived')
    expect(deriveAvailability(seat({ presence: 'error' }))).toBe('unstable')
    expect(deriveAvailability(seat({ instances: [{ presence: 'error' }] as PresenceSource['instances'] }))).toBe('unstable')
  })

  it('derives workload from running then queued counts', () => {
    expect(deriveWorkload({ runningCount: 1, queuedCount: 3 })).toBe('working')
    expect(deriveWorkload({ runningCount: 0, queuedCount: 1 })).toBe('queued')
    expect(deriveWorkload({ runningCount: 0, queuedCount: 0 })).toBe('idle')
  })

  it('takes the larger of the activity snapshot and working instances', () => {
    const working = [{ presence: 'working' }, { presence: 'working' }] as PresenceSource['instances']
    const detail = deriveAgentPresence({ status: seat({ instances: working }), activities: [activity('member:builder')] })
    expect(detail).toMatchObject({ availability: 'online', workload: 'working', runningCount: 2, capacity: 2 })
  })

  it('reports an archived seat as idle with nothing running', () => {
    const detail = deriveAgentPresence({ status: seat({ availability: 'archived' }), activities: [activity('member:builder')] })
    expect(detail).toMatchObject({ availability: 'archived', workload: 'idle', runningCount: 0 })
  })

  it('builds one presence per seat from a single pass over the activities', () => {
    const map = buildPresenceMap({
      members: [seat(), seat({ availability: 'suspended' })],
      memberIds: ['member:a', 'member:b'],
      activities: [activity('member:a'), activity('member:a')],
    })
    expect(map.get('member:a')).toMatchObject({ workload: 'working', runningCount: 2 })
    expect(map.get('member:b')).toMatchObject({ availability: 'offline', workload: 'idle' })
  })
})

describe('presence tones and orders', () => {
  it('has a tone and a label key for every availability and workload', () => {
    for (const availability of ['online', 'unstable', 'offline', 'archived'] as const) {
      expect(availabilityTone[availability]).toBeDefined()
      expect(AVAILABILITY_LABEL_KEY[availability]).toBeTruthy()
    }
    for (const workload of ['working', 'queued', 'idle'] as const) {
      expect(workloadTone[workload]).toBeDefined()
      expect(WORKLOAD_LABEL_KEY[workload]).toBeTruthy()
    }
  })

  it('lists actionable workloads first and omits archived from the filter chips', () => {
    expect(WORKLOAD_ORDER).toEqual(['working', 'queued', 'idle'])
    expect(AVAILABILITY_ORDER).toEqual(['online', 'unstable', 'offline'])
  })
})
