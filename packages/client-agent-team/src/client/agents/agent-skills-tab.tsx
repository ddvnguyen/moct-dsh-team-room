// The Agent page's Skills tab: new Team UI in the Multica look (row list, origin
// label, one master toggle), not a port — the reuse list in epic #124 has no
// skill-management surface to copy, so nothing here is derived code.
//
// One read answers both halves of the surface — the Member's whole catalog and
// the selection stored on the Member — and the write is the ordinary
// `updateMember` capabilities seam, which the Host applies at the Member's next
// turn boundary.

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamMemberSkill,
  AgentTeamMemberSkillsResult,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from '../slots.ts'
import { mintRequestId } from '../requests.ts'
import css from './agent-skills.module.css'

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly value: AgentTeamMemberSkillsResult }

/** Same selection, whatever order the names arrived in. */
function sameSelection(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (left === null || right === null) return left === right
  if (left.length !== right.length) return false
  const names = new Set(left)
  return right.every(name => names.has(name))
}

/**
 * One Member's skills and the selection that gates them: `null` loads every
 * discovered skill, a list loads exactly those names. Both halves come from one
 * read, because a Member that excluded a skill must still see it to add it back.
 */
export function AgentSkillsTab({ workspaceId, status, loadMemberSkills, updateMember, onCommitted, t }: {
  readonly workspaceId: WorkspaceId
  readonly status: AgentTeamClientMemberStatus
  readonly loadMemberSkills: TeamSidebarProps['loadMemberSkills']
  readonly updateMember?: TeamSidebarProps['updateMember']
  readonly onCommitted?: () => Promise<void> | void
  readonly t: TeamSidebarProps['t']
}) {
  const memberId = status.member.memberId
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  /** The edited selection; `null` is the load-everything mode. */
  const [draft, setDraft] = useState<readonly string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef<{ readonly requestId: ReturnType<typeof mintRequestId>; readonly allow: readonly string[] | null }>()

  const read = useCallback(async (): Promise<void> => {
    try {
      const result = await loadMemberSkills({ workspaceId, memberId })
      if (!result.ok) {
        setLoaded({ state: 'failed', message: result.error.message })
        return
      }
      setLoaded({ state: 'ready', value: result.value })
      setDraft(result.value.allow)
    } catch (cause) {
      setLoaded({ state: 'failed', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [loadMemberSkills, workspaceId, memberId])

  useEffect(() => { void read() }, [read])

  if (loaded.state === 'loading') return <p className={css.muted} data-agent-skills>{t('agentDetailsLoading')}</p>
  if (loaded.state === 'failed') return <p className={css.error} role="alert" data-agent-skills>{t('agentDetailsLoadFailed', { message: loaded.message })}</p>

  const { skills, allow } = loaded.value
  const stored = allow
  const changed = !sameSelection(draft, stored)
  const checked = (skill: AgentTeamMemberSkill): boolean => draft === null || draft.includes(skill.name)
  const selectAll = (): void => { setError(undefined); setDraft(skills.map(skill => skill.name)) }
  const toggle = (skill: AgentTeamMemberSkill): void => {
    setError(undefined)
    // The first un-tick leaves the load-everything mode, so the selection it
    // writes names every other skill explicitly — nothing changes except the
    // one the reader just turned off.
    if (draft === null) {
      setDraft(skills.filter(other => other.name !== skill.name).map(other => other.name))
      return
    }
    setDraft(draft.includes(skill.name) ? draft.filter(name => name !== skill.name) : [...draft, skill.name])
  }

  const save = async (): Promise<void> => {
    if (updateMember === undefined || saving || !changed) return
    const next = draft === null ? null : [...draft]
    // Only the two capability surfaces are stated: `skills` carries the new
    // selection (absent clears it back to load-everything) and `tools` repeats
    // the stored override, because the request replaces the whole overlay.
    const capabilities = {
      ...(status.member.capabilities?.tools === undefined ? {} : { tools: status.member.capabilities.tools }),
      ...(next === null ? {} : { skills: { allow: next } }),
    }
    const request = pending.current !== undefined && sameSelection(pending.current.allow, next)
      ? pending.current.requestId
      : mintRequestId()
    pending.current = { requestId: request, allow: next }
    setSaving(true)
    setError(undefined)
    try {
      const result = await updateMember({
        requestId: request,
        memberId,
        handle: status.member.handle,
        description: status.member.description,
        capabilities,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      pending.current = undefined
      await onCommitted?.()
      await read()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const all = draft === null
  return (
    <div className={css.tab} data-agent-skills>
      <label className={css.master}>
        <input type="checkbox" checked={all} onChange={() => { setError(undefined); if (all) selectAll(); else setDraft(null) }} />
        <span>{t('agentSkillsAll')}</span>
      </label>
      <p className={css.hint}>{all ? t('agentSkillsAllHint') : t('agentSkillsSelectedHint')}</p>
      {skills.length === 0 && <p className={css.muted}>{t('agentSkillsEmpty')}</p>}
      {skills.length > 0 && (
        <ul className={css.list}>
          {skills.map(skill => (
            <li key={skill.name} className={css.row} data-agent-skill={skill.name}>
              <label className={css.rowLabel}>
                <input type="checkbox" checked={checked(skill)} disabled={all} onChange={() => { toggle(skill) }} />
                <span className={css.rowText}>
                  <code className={css.name}>{skill.name}</code>
                  <span className={css.description}>{skill.description}</span>
                </span>
              </label>
              <span className={css.origin} data-origin={skill.origin}>{skill.origin === 'bundled' ? t('agentSkillsBundled') : t('agentSkillsPrivate')}</span>
            </li>
          ))}
        </ul>
      )}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      {updateMember !== undefined && (
        <div className={css.actions}>
          <Button disabled={saving || !changed} onClick={() => { void save() }}>
            {saving ? t('agentSkillsSaving') : t('agentSkillsSave')}
          </Button>
        </div>
      )}
    </div>
  )
}
