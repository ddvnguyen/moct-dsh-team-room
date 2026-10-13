import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One Host-owned in-band command or user-invocable skill offered by the Team composer. */
export interface TeamTriggerCatalogItem {
  readonly kind: 'command' | 'skill'
  readonly name: string
  readonly description: string
  /** Commands with an input hint are valid only at the beginning of a draft. */
  readonly leadingOnly?: boolean
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

/** Build the lazy, Session-retaining loader passed to Channel and Thread composers. */
export function createTeamTriggerCatalogLoader({
  getSessionId,
  sessions,
  remotes,
}: {
  readonly getSessionId: () => SessionId | undefined
  readonly sessions: Pick<ISessions, 'binding' | 'using'>
  readonly remotes: TeamTriggerCatalogRemotes
}): (signal: AbortSignal) => Promise<readonly TeamTriggerCatalogItem[]> {
  return async (signal) => {
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
      const [commandResult, skillResult] = await Promise.all([
        remotes.commands.list(sessionId),
        remotes.skills.list({ sessionId }, signal),
      ])
      signal.throwIfAborted()
      if (!commandResult.ok) throw new Error('commands/list failed: ' + commandResult.error.message)
      if (!skillResult.ok) throw new Error('skills/list failed: ' + skillResult.error.message)
      return [
        ...commandResult.value.map(command => ({
          kind: 'command' as const,
          name: command.name,
          description: command.description,
          ...(command.input?.hint === undefined ? {} : { leadingOnly: true }),
        })),
        ...skillResult.value.skills.map(skill => ({
          kind: 'skill' as const,
          name: skill.name,
          description: skill.description,
        })),
      ]
    })
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Temporary retained reference while Team composer command/skill catalogs load. */
    teamTriggerCatalog: unknown
  }
}
