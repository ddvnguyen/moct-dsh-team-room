// Derived from multica-x packages/views/agents/components/agents-page.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: one roster row in Multica's list language — avatar with a
// presence dot, handle and role pill, the Task the Agent is on, its current
// tool, instance load and today's tokens. The row is presentational; the
// Agents panel owns the select button, the drag handle and the row menu.

import type { AgentTeamClientMemberStatus, AgentTeamMemberActivity } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import type { AgentPresenceDetail } from '../multica/types.ts'
import { ActorAvatar } from '../multica-ui/ActorAvatar.tsx'
import { AgentPresenceDot } from '../multica-ui/AgentPresenceDot.tsx'
import { formatTokens } from '../reply-stats.ts'
import { ROLE_LABEL_KEY } from '../TeamMemberRow.tsx'
import { instanceLoad, type MemberTaskRow } from './agent-page-model.ts'
import css from './agent-list.module.css'

export function AgentRosterRow({ status, activity, task, tokens, presence, current, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly activity?: AgentTeamMemberActivity | undefined
  readonly task?: MemberTaskRow | undefined
  readonly tokens: number
  readonly presence: AgentPresenceDetail
  /** This Member's Session is the one embedded in the conversation seat. */
  readonly current?: boolean | undefined
  readonly t: TeamSidebarProps['t']
}) {
  const name = status.member.handle.replace(/^@/, '')
  const roleLabelKey = status.member.role === undefined ? undefined : (ROLE_LABEL_KEY as Readonly<Partial<Record<string, (typeof ROLE_LABEL_KEY)[keyof typeof ROLE_LABEL_KEY]>>>)[status.member.role]
  const load = instanceLoad(status)
  const tool = activity?.current
  return (
    <span className={css.row}>
      <span className={css.avatar} data-agent-avatar>
        <ActorAvatar name={name} kind="agent" size="md" />
        <span className={css.presence}><AgentPresenceDot detail={presence} compact t={t} /></span>
      </span>
      <span className={css.copy}>
        <span className={css.nameLine}>
          <strong data-agent-handle>{name}</strong>
          {roleLabelKey !== undefined && <span className={css.rolePill} data-member-role={status.member.role}>{t(roleLabelKey)}</span>}
          {current === true && <span className={css.currentPill}>{t('agentRowCurrent')}</span>}
        </span>
        <span className={css.taskLine} data-agent-current-task>
          {task === undefined
            ? <span className={css.quiet}>{t('agentRowIdle')}</span>
            : <><span className={css.taskNumber}>#{task.taskNumber}</span><span className={css.taskTitle}>{task.title}</span></>}
        </span>
        <span className={css.metaLine}>
          {tool === undefined
            ? <span className={css.quiet}>{t('agentRowNoTool')}</span>
            : <span className={css.tool} data-agent-current-tool title={tool.label}>{tool.label}</span>}
        </span>
      </span>
      <span className={css.metrics}>
        <span className={css.metric} data-agent-instances title={t('agentInstancesTitle', { busy: String(load.busy), total: String(load.total) })}>
          {t('agentRowInstances', { busy: String(load.busy), total: String(load.total) })}
        </span>
        <span className={css.metric} data-agent-tokens title={t('agentTokensTodayTitle')}>
          {formatTokens(tokens)}
        </span>
      </span>
    </span>
  )
}
