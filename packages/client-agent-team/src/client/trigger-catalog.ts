import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One Host-owned in-band command or user-invocable skill offered by the Team composer. */
export type TeamTriggerCatalogKind = 'command' | 'skill' | 'notice'

export interface TeamTriggerCatalogItem {
  /** A notice is not pickable: it explains the skill list instead of joining it. */
  readonly kind: TeamTriggerCatalogKind
  readonly name: string
  readonly description: string
  /** Commands with an input hint are valid only at the beginning of a draft. */
  readonly leadingOnly?: boolean
  /**
   * The Member a skill row belongs to. Commands are Host-owned and carry none.
   * Present on every skill row so a reader never has to guess which agent's
   * private catalog a picked skill comes from (Task 8 slice).
   */
  readonly memberHandle?: string
}

/**
 * The Member the slash-trigger list is scoped to: a live agent seat's own
 * Session, or the explicit 'no live session' state a cold or idle seat
 * reports. The composer needs the distinction so the popup can say so instead
 * of silently falling back to the Host catalog.
 */
export interface TeamTriggerCatalogScope {
  /** The Member's live Session; absent when the seat runs nothing right now. */
  readonly sessionId?: SessionId | undefined
  /** Handle of the selected Member, rendered on each of its skill rows. */
  readonly memberHandle: string
}

interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint?: string }
}

interface SkillEntry {
  readonly name: string
  readonly description: string
}

type CatalogResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } }

/** Read-only Host catalog faces needed by the Team composer. */
export interface TeamTriggerCatalogRemotes {
  readonly commands: {
    list(sessionId: SessionId): Promise<CatalogResult<readonly CommandDescriptor[]>>
  }
  readonly skills: {
    list(request: { readonly sessionId: SessionId }, signal: AbortSignal): Promise<CatalogResult<{ readonly skills: readonly SkillEntry[] }>>
  }
}

/**
 * Build the lazy, Session-retaining loader passed to Channel and Thread
 * composers.
 *
 * Commands stay Host-owned and are always read from the retained main Session:
 * the Human's own compact, undo, and friends exist before any Member does.
 * Skills are the SELECTED MEMBER's, addressed by that Member's own sessionId,
 * which resolves its cwd and preset on the Host, so one Member's private skills
 * directory and allow-list come back and a sibling's do not. A selected Member
 * with no live Session yields the Host commands plus an explicit no-session row
 * instead of an empty list that reads as breakage.
 */
export function createTeamTriggerCatalogLoader({
  getSessionId,
  sessions,
  remotes,
}: {
  readonly getSessionId: () => SessionId | undefined
  readonly sessions: Pick<ISessions, 'binding' | 'using'>
  readonly remotes: TeamTriggerCatalogRemotes
}): (scope: TeamTriggerCatalogScope, signal: AbortSignal) => Promise<readonly TeamTriggerCatalogItem[]> {
  return async (scope, signal) => {
    const sessionId = getSessionId()
    if (sessionId === undefined || sessions.binding(sessionId) === undefined) {
      throw new Error('Team command and skill catalogs require a retained main Session')
    }
    signal.throwIfAborted()
    return sessions.using(sessionId, { source: 'teamTriggerCatalog', signal }, async (reference) => {
      const state = reference.binding.session.getSnapshot()
      if (state.openState !== 'open') {
        throw state.openError ?? new Error('Session "' + sessionId + '" is not open')
      }
      signal.throwIfAborted()
      // The Member's own skills ride its own Session. Without one, the Host
      // commands still load and the skill list carries the reason instead of
      // silently borrowing the Host catalog.
      const memberSkills = scope.sessionId === undefined
        ? []
        : await listMemberSkills(sessions, remotes, scope.sessionId, scope.memberHandle, signal)
      // Host commands come from the retained main Session, exactly where they
      // came from before the selector existed.
      const commandResult = await remotes.commands.list(sessionId)
      signal.throwIfAborted()
      if (!commandResult.ok) throw new Error('commands/list failed: ' + commandResult.error.message)
      return [
        ...commandResult.value.map(command => ({
          kind: 'command' as const,
          name: command.name,
          description: command.description,
          ...(command.input?.hint === undefined ? {} : { leadingOnly: true }),
        })),
        ...(scope.sessionId === undefined
          ? [{
            kind: 'notice' as const,
            name: 'no-active-session',
            description: '@' + scope.memberHandle,
            memberHandle: scope.memberHandle,
          }]
          : memberSkills),
      ]
    })
  }
}

/**
 * Read one Member's user-invocable skills through its own Session.
 *
 * The Member's Session is retained for the read exactly like the main Session
 * is: the Host resolves the catalog from that Session's cwd and preset, which
 * is what makes the answer that Member's and nobody else's. Reusing the
 * Member's existing sessionId adds no new op kind and no schema change, so no
 * contract check is owed for it.
 */
async function listMemberSkills(
  sessions: Pick<ISessions, 'binding' | 'using'>,
  remotes: TeamTriggerCatalogRemotes,
  memberSessionId: SessionId,
  memberHandle: string,
  signal: AbortSignal,
): Promise<readonly TeamTriggerCatalogItem[]> {
  if (sessions.binding(memberSessionId) === undefined) {
    throw new Error('Member "' + memberSessionId + '" has no retained Session')
  }
  return sessions.using(memberSessionId, { source: 'teamTriggerCatalog', signal }, async (memberReference) => {
    const state = memberReference.binding.session.getSnapshot()
    if (state.openState !== 'open') {
      throw state.openError ?? new Error('Session "' + memberSessionId + '" is not open')
    }
    signal.throwIfAborted()
    const result = await remotes.skills.list({ sessionId: memberSessionId }, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error('skills/list failed: ' + result.error.message)
    return result.value.skills.map(skill => ({
      kind: 'skill' as const,
      name: skill.name,
      description: skill.description,
      memberHandle,
    }))
  })
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Temporary retained reference while Team composer command/skill catalogs load. */
    teamTriggerCatalog: unknown
  }
}
