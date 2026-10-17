// Derived from multica-x packages/core/agents/derive-presence.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Two independent dimensions: availability (reachability) and workload (what
// is on the plate right now). The Team Room has no runtime registry, so
// availability comes from the seat's own status and workload from live
// Member activity plus the seat's instance presence.

import type { ActivitySource, AgentPresenceDetail, PresenceSource } from './types.ts'

/** Availability from a seat's lifecycle status and its instances' presence. */
export function deriveAvailability(
  status: PresenceSource,
): AgentPresenceDetail['availability'] {
  if (status.availability === 'archived') return 'archived'
  if (status.availability === 'inactive') return 'archived'
  if (status.availability === 'suspended' || status.availability === 'unavailable') return 'offline'
  if (status.presence === 'error' || status.instances.some(instance => instance.presence === 'error')) return 'unstable'
  return 'online'
}

export function deriveWorkload(counts: { runningCount: number; queuedCount: number }): AgentPresenceDetail['workload'] {
  if (counts.runningCount > 0) return 'working'
  if (counts.queuedCount > 0) return 'queued'
  return 'idle'
}

/**
 * One seat's presence. `activities` must already be narrowed to the seat —
 * callers build that map once per snapshot (see `buildPresenceMap`).
 */
export function deriveAgentPresence(input: {
  status: PresenceSource
  activities: readonly ActivitySource[]
}): AgentPresenceDetail {
  const availability = deriveAvailability(input.status)
  if (availability === 'archived') {
    return {
      availability,
      workload: 'idle',
      runningCount: 0,
      queuedCount: 0,
      capacity: input.status.member.instances ?? 1,
    }
  }
  const runningCount = input.activities.length
  const workingInstances = input.status.instances.filter(instance => instance.presence === 'working').length
  // An activity snapshot is live proof; instance presence can lag a turn end.
  const live = Math.max(runningCount, workingInstances)
  return {
    availability,
    workload: deriveWorkload({ runningCount: live, queuedCount: 0 }),
    runningCount: live,
    queuedCount: 0,
    capacity: input.status.member.instances ?? 1,
  }
}

/** Workspace-level batch builder: one pass over seats and one over activities. */
export function buildPresenceMap(args: {
  members: readonly PresenceSource[]
  activities: readonly ActivitySource[]
  memberIds: readonly string[]
}): Map<string, AgentPresenceDetail> {
  const activitiesByMember = new Map<string, ActivitySource[]>()
  for (const activity of args.activities) {
    const list = activitiesByMember.get(activity.memberId)
    if (list !== undefined) list.push(activity)
    else activitiesByMember.set(activity.memberId, [activity])
  }
  const out = new Map<string, AgentPresenceDetail>()
  args.members.forEach((status, index) => {
    const memberId = args.memberIds[index]
    if (memberId === undefined) return
    out.set(memberId, deriveAgentPresence({
      status,
      activities: activitiesByMember.get(memberId) ?? [],
    }))
  })
  return out
}
