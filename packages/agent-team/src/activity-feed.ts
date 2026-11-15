/**
 * Host activity feed (A13 v2): one running Turn per seat, folded from session
 * events in process memory only. Nothing here is written to the ledger, MOCT or
 * disk, and no label ever carries arguments, command text, output, env or
 * credential-shaped strings.
 *
 * Rules (contract §10 A13):
 * - only seats with a running Turn are returned, one entry per instance slot
 *   (multi-instance contract v2 §3: slot 0 is the seat's main Session);
 * - an entry is removed on `agent/status` idle and on `agent/error`;
 * - an entry whose `updatedAt` is older than STALE_MS is dropped on read;
 * - at most one invalidation per seat per THROTTLE_MS window.
 *
 * A running entry also carries the last few step labels of its Turn
 * (`ACTIVITY_STEPS_MAX`), newest last: what `activityLabel` made of each tool
 * call, so a reader sees the shape of the work and not just its newest call.
 * The feed is the only source of those labels — no assistant text, no
 * arguments, no second Session read path.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AgentTeamMemberActivity } from './types/requests-results.ts'
import type { AgentTeamMemberId, AgentTeamThreadRef } from './types/entities.ts'

export const ACTIVITY_STALE_MS = 5 * 60 * 1000
export const ACTIVITY_THROTTLE_MS = 500
export const ACTIVITY_LABEL_MAX = 80
/** How many of the running Turn's recent step labels the snapshot carries. */
export const ACTIVITY_STEPS_MAX = 3
const TOOL_NAME_MAX = 40
const SHELL_LIKE = /shell|bash|pwsh|powershell|exec|command|terminal/i
const PATH_KEYS = ['path', 'file_path', 'filePath'] as const
/** Basenames that look like credentials or URLs are dropped, not shown. */
const SECRET_LIKE = /sk-|bearer|authorization|token|secret|password|https?:\/\//i

export interface AgentTeamActivityIdentity {
  readonly handle: string
  readonly threadRef?: AgentTeamThreadRef
}

/** One running Turn per (seat, instance slot). */
type ActivityKey = `${AgentTeamMemberId}#${number}`
const activityKey = (memberId: AgentTeamMemberId, slot: number): ActivityKey => `${memberId}#${slot}`

interface ActivityEntry {
  readonly memberId: AgentTeamMemberId
  readonly slot: number
  readonly handle: string
  readonly threadRef?: AgentTeamThreadRef
  readonly turn: number
  readonly turnStartedAt: string
  stepCount: number
  toolCount: number
  current: { readonly tool: string; readonly label: string } | undefined
  readonly steps: { readonly tool: string; readonly label: string }[]
  readonly pendingCalls: Map<string, string>
  updatedAt: number
  lastEmit: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface AgentTeamActivityFeedOptions {
  /** Resolves a seat's '@handle' and the slot's Thread for the event being folded; undefined skips it. */
  readonly identify: (memberId: AgentTeamMemberId, slot: number) => AgentTeamActivityIdentity | undefined
  /** Called at most once per seat per THROTTLE_MS: the host bumps its activity epoch here. */
  readonly invalidate: (memberId: AgentTeamMemberId) => void
  readonly now?: () => number
  readonly schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
}

/** Keep a tool name only when it is a short, plain identifier; anything else becomes `tool`. */
export function safeToolName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > TOOL_NAME_MAX) return 'tool'
  if (/\s|=/.test(name)) return 'tool'
  return name
}

/** Tool name, plus the basename of one path-like argument for non-shell tools. Never the arguments themselves. */
export function activityLabel(name: unknown, rawArguments: unknown): { readonly tool: string; readonly label: string } {
  const tool = safeToolName(name)
  if (SHELL_LIKE.test(tool)) return { tool, label: tool.slice(0, ACTIVITY_LABEL_MAX) }
  let base: string | undefined
  if (typeof rawArguments === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawArguments)
      if (typeof parsed === 'object' && parsed !== null) {
        for (const key of PATH_KEYS) {
          const value = (parsed as Record<string, unknown>)[key]
          if (typeof value === 'string' && value.length > 0) {
            base = value.split(/[\\/]/).pop()
            break
          }
        }
      }
    } catch {
      base = undefined
    }
  }
  if (base === undefined || base.length === 0 || SECRET_LIKE.test(base)) return { tool, label: tool }
  return { tool, label: `${tool} ${base}`.slice(0, ACTIVITY_LABEL_MAX) }
}

export class AgentTeamActivityFeed {
  private readonly entries = new Map<ActivityKey, ActivityEntry>()
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>

  constructor(private readonly options: AgentTeamActivityFeedOptions) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  }

  /** Fold one session event into the running Turn of a seat's instance slot (0 = main Session). */
  onSessionEvent(memberId: AgentTeamMemberId, event: SessionEvent, slot = 0): void {
    const time = Number.isFinite(event.time) ? event.time : this.now()
    switch (event.type) {
      case 'step/start': {
        const entry = this.entryFor(memberId, slot, event.data.turn, time)
        if (entry === undefined) return
        entry.stepCount += 1
        this.touch(entry, time)
        return
      }
      case 'tool/call': {
        const entry = this.entryFor(memberId, slot, event.data.turn, time)
        if (entry === undefined) return
        entry.toolCount += 1
        entry.pendingCalls.set(event.data.callId, event.data.name)
        entry.current = activityLabel(event.data.name, event.data.arguments)
        // The step feed a card renders: the same label, kept as history so the
        // reader sees what the Turn has been doing, not only its newest call.
        entry.steps.push(entry.current)
        if (entry.steps.length > ACTIVITY_STEPS_MAX) entry.steps.shift()
        this.touch(entry, time)
        return
      }
      case 'tool/result': {
        const entry = this.entries.get(activityKey(memberId, slot))
        if (entry === undefined) return
        const callId = event.data.message.source.callId
        if (entry.pendingCalls.delete(callId) && entry.current !== undefined) entry.current = undefined
        this.touch(entry, time)
        return
      }
      default:
        return
    }
  }

  /** Agent went idle: the slot's running Turn is over. */
  onAgentIdle(memberId: AgentTeamMemberId, slot = 0): void {
    this.remove(activityKey(memberId, slot))
  }

  /** Agent failed: the slot's running Turn is over. */
  onAgentError(memberId: AgentTeamMemberId, slot = 0): void {
    this.remove(activityKey(memberId, slot))
  }

  /** Running Turns, optionally for one Thread; stale entries are dropped here. */
  snapshot(threadRef?: AgentTeamThreadRef): readonly AgentTeamMemberActivity[] {
    const cutoff = this.now() - ACTIVITY_STALE_MS
    const out: AgentTeamMemberActivity[] = []
    for (const [key, entry] of this.entries) {
      if (entry.updatedAt < cutoff) {
        this.remove(key)
        continue
      }
      if (threadRef !== undefined && entry.threadRef !== threadRef) continue
      out.push(Object.freeze({
        memberId: entry.memberId,
        ...(entry.slot !== 0 ? { slot: entry.slot } : {}),
        handle: entry.handle,
        ...(entry.threadRef !== undefined ? { threadRef: entry.threadRef } : {}),
        turnStartedAt: entry.turnStartedAt,
        stepCount: entry.stepCount,
        toolCount: entry.toolCount,
        ...(entry.current !== undefined ? { current: Object.freeze({ ...entry.current }) } : {}),
        ...(entry.steps.length > 0 ? { steps: Object.freeze(entry.steps.map(step => Object.freeze({ ...step }))) } : {}),
        updatedAt: new Date(entry.updatedAt).toISOString(),
      }))
    }
    return Object.freeze(out)
  }

  /** Drop every seat's pending timers; used on host shutdown. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
    }
    this.entries.clear()
  }

  private entryFor(memberId: AgentTeamMemberId, slot: number, turn: number, time: number): ActivityEntry | undefined {
    const key = activityKey(memberId, slot)
    const existing = this.entries.get(key)
    if (existing !== undefined && existing.turn === turn) return existing
    const identity = this.options.identify(memberId, slot)
    if (identity === undefined) return undefined
    if (existing !== undefined) this.remove(key)
    const entry: ActivityEntry = {
      memberId,
      slot,
      handle: identity.handle,
      ...(identity.threadRef !== undefined ? { threadRef: identity.threadRef } : {}),
      turn,
      turnStartedAt: new Date(time).toISOString(),
      stepCount: 0,
      toolCount: 0,
      current: undefined,
      steps: [],
      timer: undefined,
      pendingCalls: new Map(),
      updatedAt: time,
      lastEmit: Number.NEGATIVE_INFINITY,
    }
    this.entries.set(key, entry)
    return entry
  }

  private touch(entry: ActivityEntry, time: number): void {
    entry.updatedAt = Math.max(entry.updatedAt, time)
    const now = this.now()
    const wait = entry.lastEmit + ACTIVITY_THROTTLE_MS - now
    if (wait <= 0) {
      entry.lastEmit = now
      this.options.invalidate(entry.memberId)
      return
    }
    if (entry.timer !== undefined) return
    entry.timer = this.schedule(() => {
      entry.timer = undefined
      if (this.entries.get(activityKey(entry.memberId, entry.slot)) !== entry) return
      entry.lastEmit = this.now()
      this.options.invalidate(entry.memberId)
    }, wait)
  }

  private remove(key: ActivityKey): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    this.entries.delete(key)
    this.options.invalidate(entry.memberId)
  }
}
