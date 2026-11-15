// Derived from multica-x packages/views/issues/components/inline-comment-run.tsx
// and issue-agent-activity-indicator.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad.
// Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica draws a running agent inside the timeline item it
// belongs to and resolves it through query hooks. Here the card sits above the
// history list in the issue's main column — one card per (seat, instance slot)
// that is running a Turn on this Thread — and every value on it is the Host's:
// the slots come from the roster's instance list, the step feed from the
// `memberActivity` snapshot, and Stop goes through the same `session.cancel`
// the execution log's rows use. Nothing here reads a Session: the transcript
// is one control away, in the native dsh session.

import { useMemo, useState } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, Modal, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivitySource, ActivityStepSource } from '../multica/types.ts'
import { formatDuration } from '../multica/task-run-labels.ts'
import { ActorAvatar } from '../multica-ui/ActorAvatar.tsx'
import { useTickingNow } from '../thread/ExecutionLog.tsx'
import type { TeamConversationProps } from '../slots.ts'
import { runStepLines } from './run-step.ts'
import css from './issue-view.module.css'

type SessionId = AgentTeamClientMemberStatus['member']['sessionId']

/** One live card: a seat's instance slot running a Turn on this Thread. */
export interface RunningAgentCard {
  readonly memberId: AgentTeamMemberId
  readonly slot: number
  /** The seat's handle, without its '@'. */
  readonly handle: string
  /** The slot's live Session, when the roster names one: the card's two controls act on it. */
  readonly sessionId: SessionId | undefined
  /** When the running Turn started, when the feed has folded its first step. */
  readonly turnStartedAt: string | undefined
  readonly toolCount: number | undefined
  /** The Turn's recent steps, newest last. */
  readonly steps: readonly ActivityStepSource[]
  /** How many instance slots the seat has: the card names its slot only when there is a choice. */
  readonly totalSlots: number
}

/** The seat's handle as the roster spells it: the feed's '@handle' loses its '@' here. */
const bareHandle = (handle: string): string => handle.startsWith('@') ? handle.slice(1) : handle

/**
 * The cards to draw: one per (seat, slot) that is running on this Thread.
 *
 * The roster's instance list is the slot authority — slot, live Session and
 * `threadRefs` (a slot bound to this Thread) — and the activity feed is the
 * Turn authority: its step feed, tool count and start instant. Either can
 * speak for a slot; the union is what a reader sees, so a slot the roster
 * already reports as working is not hidden by a feed that has not folded its
 * first event, and a running Turn the roster no longer binds is not hidden by
 * that either. Activities for a seat the roster does not name still draw a
 * card: the feed carries the handle.
 */
export function runningAgentCards(
  members: readonly AgentTeamClientMemberStatus[],
  activities: readonly ActivitySource[],
  threadRef: AgentTeamThreadRef,
): readonly RunningAgentCard[] {
  const statusById = new Map(members.map(status => [status.member.memberId, status]))
  const cards: RunningAgentCard[] = []
  const seen = new Set<string>()

  for (const activity of activities) {
    if (activity.threadRef !== undefined && activity.threadRef !== threadRef) continue
    const slot = activity.slot ?? 0
    const memberId = activity.memberId as AgentTeamMemberId
    const key = `${memberId}#${slot}`
    if (seen.has(key)) continue
    seen.add(key)
    const status = statusById.get(memberId)
    const instance = status?.instances.find(candidate => candidate.slot === slot)
    cards.push({
      memberId,
      slot,
      handle: bareHandle(status?.member.handle ?? activity.handle),
      // The roster names the slot's live Session or the card has no control:
      // `member.sessionId` is a Session id, not proof this slot is running on
      // this Thread, and a Stop aimed at the wrong one is worse than no Stop.
      sessionId: instance?.sessionId,
      turnStartedAt: activity.turnStartedAt,
      toolCount: activity.toolCount,
      steps: activity.steps ?? [],
      totalSlots: Math.max(1, status?.instances.length ?? 1),
    })
  }

  // A slot the roster says is working on this Thread carries a card even while
  // the feed has nothing folded for it yet.
  for (const status of members) {
    for (const instance of status.instances) {
      if (instance.presence !== 'working' || !instance.threadRefs.includes(threadRef)) continue
      const key = `${status.member.memberId}#${instance.slot}`
      if (seen.has(key)) continue
      seen.add(key)
      cards.push({
        memberId: status.member.memberId,
        slot: instance.slot,
        handle: bareHandle(status.member.handle),
        sessionId: instance.sessionId,
        turnStartedAt: undefined,
        toolCount: undefined,
        steps: [],
        totalSlots: Math.max(1, status.instances.length),
      })
    }
  }

  const startedAt = (card: RunningAgentCard): number => card.turnStartedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(card.turnStartedAt)
  return cards.sort((left, right) => startedAt(left) - startedAt(right)
    || left.memberId.localeCompare(right.memberId)
    || left.slot - right.slot)
}

export interface IssueRunningAgentsProps {
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly threadRef: AgentTeamThreadRef
  /** The Thread's running Turns: the feed the card's step line and counts come from. */
  readonly activities: readonly ActivitySource[]
  /** Sessions whose Stop the Host accepted and whose activity row has not cleared yet. */
  readonly stopping: ReadonlySet<string>
  readonly onOpenSession: (sessionId: SessionId) => void
  /** Accepts a Stop for one Session; the card reads "stopping…" until the Host refolds. */
  readonly onStop: (sessionId: SessionId) => void
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's running agents: the cards above the history list, one per live
 * (seat, slot). A quiet board renders nothing — no placeholder chrome — and
 * the elapsed timer ticks only while a card is on screen.
 */
export function IssueRunningAgents({ members, threadRef, activities, stopping, onOpenSession, onStop, t }: IssueRunningAgentsProps) {
  const cards = useMemo(() => runningAgentCards(members, activities, threadRef), [members, activities, threadRef])
  const [confirming, setConfirming] = useState<RunningAgentCard>()
  const now = useTickingNow(cards.length > 0)
  if (cards.length === 0) return null

  return (
    <section className={css.runningAgents} aria-label={t('issueRunCardLabel')} data-issue-running-agents="" data-testid="issue-running-agents">
      {cards.map(card => {
        const stoppingNow = card.sessionId !== undefined && stopping.has(card.sessionId)
        const elapsed = card.turnStartedAt === undefined ? undefined : Math.max(0, now - Date.parse(card.turnStartedAt))
        const lines = runStepLines(card.steps, t)
        const act = (action: (sessionId: SessionId) => void) => (): void => {
          if (card.sessionId !== undefined) action(card.sessionId)
        }
        return (
          <article
            key={`${card.memberId}#${card.slot}`}
            className={css.runCard}
            data-running-agent={card.memberId}
            data-running-slot={String(card.slot)}
            data-run-state={stoppingNow ? 'stopping' : 'running'}
          >
            <div className={css.runCardHead}>
              <ActorAvatar name={card.handle} kind="agent" size="sm" />
              <span className={css.runCardHandle}>{`@${card.handle}`}</span>
              {card.totalSlots > 1 && (
                <span className={css.runCardSlot} data-running-slot-chip="">{t('runCardSlot', { slot: String(card.slot) })}</span>
              )}
              <span className={css.runCardSpinner} aria-hidden="true" />
              <TextShimmer active className={css.runCardLabel}>{stoppingNow ? t('stopRunStopping') : t('runCardWorking')}</TextShimmer>
              {elapsed !== undefined && <span className={css.runCardMeta} data-run-elapsed="">{formatDuration(elapsed)}</span>}
              {card.toolCount !== undefined && (
                <span className={css.runCardMeta} data-run-tool-count="">{t('activityToolCount', { count: String(card.toolCount) })}</span>
              )}
              <span className={css.runCardActions}>
                <Button size="sm" variant="outline" disabled={card.sessionId === undefined} onClick={act(onOpenSession)}>{t('openSession')}</Button>
                {!stoppingNow && (
                  <Button size="sm" variant="outline" disabled={card.sessionId === undefined} onClick={() => { setConfirming(card) }}>{t('stopRun')}</Button>
                )}
              </span>
            </div>
            <ol className={css.runCardSteps} data-running-steps="">
              {lines.map((line, index) => (
                <li
                  key={`${line}:${index}`}
                  className={index === 0 ? css.runCardStepNow : css.runCardStep}
                  data-running-step={index === 0 ? 'now' : 'recent'}
                >
                  {line}
                </li>
              ))}
            </ol>
          </article>
        )
      })}
      {confirming !== undefined && (
        <Modal
          open
          onClose={() => { setConfirming(undefined) }}
          title={t('stopRunTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <Button variant="outline" onClick={() => { setConfirming(undefined) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => {
              const card = confirming
              setConfirming(undefined)
              if (card.sessionId !== undefined) onStop(card.sessionId)
            }}>{t('stopRun')}</Button>
          </>}
        >
          <p className={css.error}>{t('stopRunBody', { handle: confirming.handle })}</p>
        </Modal>
      )}
    </section>
  )
}
