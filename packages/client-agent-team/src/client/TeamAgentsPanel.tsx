import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamClientMemberStatus,
  AgentTeamMemberActivity,
  AgentTeamMemberRole,
  AgentTeamModelSelection,
  AgentTeamSessionRun,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconArchiveOutlineRegular, IconClockOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Input, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
import { moveSidebarItem, useSidebarOrder } from './sidebar-order.ts'
import { useSidebarSectionOpen, setSidebarSectionOpen } from './sidebar-sections.ts'
import { mintRequestId } from './requests.ts'
import { diagnosticText, restartOffered } from './TeamPresenceDot.tsx'
import { TeamRowMenu } from './TeamRowMenu.tsx'
import { TeamSidebarSection } from './TeamSidebarSection.tsx'
import { AgentEditorDialog, ModelPickerField, RoleField, sameModel, warmModelCatalog } from './TeamMemberEditor.tsx'
import { TeamAgentImport } from './TeamAgentImport.tsx'
import { buildPresenceMap, deriveAgentPresence } from './multica/derive-presence.ts'
import type { AgentPresenceDetail } from './multica/types.ts'
import { AgentListToolbar, EMPTY_AGENT_FILTERS, type AgentListFilters } from './agents/agent-list-toolbar.tsx'
import { AgentRosterRow } from './agents/agent-row.tsx'
import { currentTaskOf, tokensToday } from './agents/agent-page-model.ts'
import createCss from './create.module.css'
import css from './sidebar.module.css'

interface TeamAgentsPanelProps {
  readonly workspaceId: WorkspaceId
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly subscribeChanges: TeamSidebarProps['subscribeChanges']
  readonly addMember: TeamSidebarProps['addMember']
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly recoverMember: TeamSidebarProps['recoverMember']
  readonly archiveMember: TeamSidebarProps['archiveMember']
  readonly joinWorkspace: TeamSidebarProps['joinWorkspace']
  readonly leaveWorkspace: TeamSidebarProps['leaveWorkspace']
  readonly loadModels: TeamSidebarProps['loadModels']
  /** Live running-Turn snapshot: the row's current tool and workload dot. */
  readonly loadMemberActivity?: TeamSidebarProps['loadMemberActivity']
  /** The board's catalog: the row's current Task and the detail's Tasks tab. */
  readonly loadBoard?: TeamSidebarProps['loadBoard']
  /** Today's tokens come from the Member's Session runs. */
  readonly loadMemberSessions?: TeamSidebarProps['loadMemberSessions']
  /** The Member Session currently embedded in the conversation seat, if any. */
  readonly memberSessionId?: AgentTeamClientMemberStatus['member']['sessionId']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly openAgentDetail: TeamSidebarProps['openAgentDetail']
  readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void
  readonly t: TeamSidebarProps['t']
}

export function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, addMember, updateMember, recoverMember, archiveMember, joinWorkspace, leaveWorkspace, loadModels, loadMemberActivity, loadBoard, loadMemberSessions, memberSessionId, openMemberSession, openAgentDetail, onCreatingChange, t }: TeamAgentsPanelProps) {
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [activities, setActivities] = useState<readonly AgentTeamMemberActivity[]>([])
  const [board, setBoard] = useState<AgentTeamView>()
  const [runsByMember, setRunsByMember] = useState<ReadonlyMap<string, readonly AgentTeamSessionRun[]>>(new Map())
  const [filters, setFilters] = useState<AgentListFilters>(EMPTY_AGENT_FILTERS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [handle, setHandle] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState<AgentTeamModelSelection | undefined>(undefined)
  const [role, setRole] = useState<AgentTeamMemberRole | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [retryRequest, setRetryRequest] = useState<AgentTeamAddMemberRequest>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Same presentation-preference ordering as the Channels list; the drag
  // commits through one shared mutation.
  const agentRefs = useMemo(() => members.map(status => status.member.memberId), [members])
  const orderedAgentRefs = useSidebarOrder(workspaceId, 'agents', agentRefs)
  const orderedMembers = useMemo(() => {
    const byId = new Map(members.map(status => [status.member.memberId, status]))
    return orderedAgentRefs.map(memberId => byId.get(memberId)).filter(status => status !== undefined)
  }, [orderedAgentRefs, members])
  const applyMove = (movedRef: typeof agentRefs[number], targetRef: typeof agentRefs[number], marker: 'before' | 'after'): void => {
    void moveSidebarItem(workspaceId, 'agents', orderedAgentRefs, movedRef, targetRef, marker)
  }
  const drag = useSidebarRowDrag({ refs: orderedAgentRefs, onCommit: applyMove })
  const sectionOpen = useSidebarSectionOpen(workspaceId, 'agents')

  // Observed old→new Session binding per Member while this panel is
  // mounted. A model-initiated rollover moves the binding without any
  // Client action; when the conversation seat is showing the Member's
  // previous live Session, the panel follows to the new one exactly once —
  // but only after the refreshed status is actually active, so the commit
  // window (binding moved, new Session not yet live) never redirects to a
  // Session that does not exist. The follow requires the seat to still show
  // the previous Session at completion as well: a rollover observed while
  // unavailable stays pending, and navigating away before it completes
  // cancels the follow instead of pulling the pane back.
  const observedSessionIds = useRef(new Map<string, AgentTeamClientMemberStatus['member']['sessionId']>())
  const pendingFollows = useRef(new Map<string, { readonly previousSessionId: AgentTeamClientMemberStatus['member']['sessionId']; readonly nextSessionId: AgentTeamClientMemberStatus['member']['sessionId'] }>())
  // The seat's embedded Session id rides a ref: the change subscription may
  // deliver an invalidation through a refresh closure captured before the
  // seat rebinds, and the follow decision must always read the live value.
  const seatSessionIdRef = useRef(memberSessionId)
  seatSessionIdRef.current = memberSessionId
  const openMemberSessionRef = useRef(openMemberSession)
  openMemberSessionRef.current = openMemberSession
  const followRollover = useCallback((statuses: readonly AgentTeamClientMemberStatus[]) => {
    for (const status of statuses) {
      const memberId = status.member.memberId
      const observed = observedSessionIds.current.get(memberId)
      if (observed === undefined) {
        observedSessionIds.current.set(memberId, status.member.sessionId)
        continue
      }
      if (observed !== status.member.sessionId) {
        observedSessionIds.current.set(memberId, status.member.sessionId)
        // Only the exact previous live page follows; browsing an older
        // archive or another Member stays untouched. A binding change seen
        // before any page is embedded is still recorded so the observation
        // baseline stays current.
        const seatSessionId = seatSessionIdRef.current
        if (seatSessionId !== undefined && observed === seatSessionId) pendingFollows.current.set(memberId, { previousSessionId: observed, nextSessionId: status.member.sessionId })
        else pendingFollows.current.delete(memberId)
      }
      const pending = pendingFollows.current.get(memberId)
      if (pending !== undefined && pending.nextSessionId === status.member.sessionId && status.availability === 'active') {
        // The seat must still show the followed Member's previous Session at
        // completion too: the commit window can outlive the user's patience,
        // and navigating away (or onto another Member/archive view) cancels
        // the follow instead of yanking the pane back onto the new Session.
        const seatSessionId = seatSessionIdRef.current
        pendingFollows.current.delete(memberId)
        if (seatSessionId !== undefined && seatSessionId === pending.previousSessionId) openMemberSessionRef.current(pending.nextSessionId)
      }
    }
  }, [])

  // Only the first refresh owns the loading surface; presence wakes (Agent
  // running/idle) ride the dedicated scope and refresh rows in place.
  const loadedRef = useRef(false)
  const mountedRef = useRef(false)
  // The row facts the list derives from, refreshed with the roster: the live
  // activity snapshot and the board catalog (the Task the Agent is on). Both
  // read through the query layer, so a wake that changes nothing costs a cache
  // hit rather than a Host round trip.
  const refreshFacts = useCallback(async () => {
    const reads: Promise<void>[] = []
    if (loadMemberActivity !== undefined) {
      reads.push((async () => {
        try {
          const result = await loadMemberActivity({ workspaceId })
          if (mountedRef.current && result.ok) setActivities(result.value.activities)
        } catch { /* the rows keep their last snapshot */ }
      })())
    }
    if (loadBoard !== undefined) {
      reads.push((async () => {
        try {
          const result = await loadBoard({ workspaceId })
          if (mountedRef.current && result.ok) setBoard(result.value)
        } catch { /* the rows keep their last Task */ }
      })())
    }
    await Promise.all(reads)
  }, [loadMemberActivity, loadBoard, workspaceId])
  // The roster on its own: a presence wake moves the rows (the dots, the
  // current Task) and must not re-read the board catalog, whose read rides the
  // same `view` remote as the open Thread's facts.
  const refreshRoster = useCallback(async () => {
    const result = await loadMembers({ workspaceId })
    if (!mountedRef.current) return
    if (result.ok) {
      const next = result.value.filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived')
      setMembers(next)
      followRollover(next)
      setError(undefined)
      loadedRef.current = true
    } else {
      setError(result.error.message)
    }
  }, [loadMembers, workspaceId, followRollover])
  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    void refreshFacts()
    const result = await loadMembers({ workspaceId })
    // A response for a panel the user has already left changes nothing: the
    // key-remounted successor owns the roster state — and the seat-follow
    // side effects — now.
    if (!mountedRef.current) return
    if (result.ok) {
      // Archived Members are hidden from every surface; the row disappears
      // the moment the workspace-scope wake delivers the archived state.
      const next = result.value.filter(status => status.member.state !== 'inactive' && status.member.state !== 'archived')
      setMembers(next)
      followRollover(next)
      setError(undefined)
      loadedRef.current = true
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }, [loadMembers, workspaceId, followRollover, refreshFacts])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  // Warm the Host model catalog while the roster loads, so the create and
  // edit pickers open with rows instead of paying the first read on open.
  // Mount-scoped (not per refresh): presence wakes must not refetch it.
  useEffect(() => { warmModelCatalog(loadModels) }, [loadModels])
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    // The section stays mounted across Channel creation, so the Member roster
    // rides every workspace invalidation.
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])
  // Presence transitions commit nothing: the Host wakes only this scope, so
  // the green dots stay live without any catalog refetch.
  useEffect(() => subscribeChanges({ kind: 'presence', workspaceId }, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    // Rows only: the dots and the current Task are roster facts, and the
    // catalog read belongs to the Workspace scope.
    void refreshRoster()
  }), [subscribeChanges, refreshRoster, workspaceId])

  // Today's tokens per Member. This is the one read the list needs per row
  // rather than per Workspace, so it is keyed by the roster's Session
  // bindings and never refetched by a presence wake.
  const membersRef = useRef(members)
  membersRef.current = members
  const sessionKey = members.map(status => `${status.member.memberId}:${status.member.sessionId}`).join(',')
  useEffect(() => {
    if (loadMemberSessions === undefined || sessionKey === '') return
    let live = true
    void (async () => {
      const entries = await Promise.all(membersRef.current.map(async status => {
        try {
          const result = await loadMemberSessions({ workspaceId, memberId: status.member.memberId })
          return [status.member.memberId, result.ok ? result.value.runs : []] as const
        } catch {
          return [status.member.memberId, []] as const
        }
      }))
      if (live) setRunsByMember(new Map(entries))
    })()
    return () => { live = false }
  }, [loadMemberSessions, workspaceId, sessionKey])

  const closeForm = () => {
    if (creating) return
    setFormOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const provision = async (request: AgentTeamAddMemberRequest) => {
    setCreating(true)
    onCreatingChange(request, true)
    setError(undefined)
    setRetryRequest(request)
    try {
      const result = await addMember(request)
      if (result.ok) {
        const committed = { ...result.value.status, workspaceIds: result.value.workspaceIds }
        setMembers(current => {
          const retained = current.filter(status => status.member.memberId !== committed.member.memberId)
          return committed.member.state === 'inactive' || committed.member.state === 'archived' ? retained : [...retained, committed]
        })
        setHandle('')
        setDescription('')
        setModel(undefined)
        setRole(undefined)
        setFormOpen(false)
        if (result.value.status.presence === 'unavailable') {
          setError(diagnosticText(result.value.status) || t('statusUnavailable'))
        } else {
          setRetryRequest(undefined)
        }
        queueMicrotask(() => { triggerRef.current?.focus() })
      } else {
        await refresh()
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCreating(false)
      onCreatingChange(request, false)
    }
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedHandle = handle.trim()
    const normalizedDescription = description.trim()
    if (normalizedHandle.length === 0 || creating) return
    const sameRequest = retryRequest !== undefined && retryRequest.workspaceId === workspaceId
      && retryRequest.handle === normalizedHandle && retryRequest.description === normalizedDescription
      && sameModel(retryRequest.model, model)
      && retryRequest.role === role
      && retryRequest.channelRefs.length === 0
    void provision(sameRequest ? retryRequest : {
      requestId: mintRequestId(),
      workspaceId,
      handle: normalizedHandle,
      description: normalizedDescription,
      presetId: 'team-member',
      // No initial Channels at creation: the Member joins Channels later from
      // the Channel side and stays reachable through its DM view meanwhile.
      channelRefs: [],
      ...(model === undefined ? {} : { model }),
      ...(role === undefined ? {} : { role }),
    })
  }

  const presenceByMember = buildPresenceMap({ members, activities, memberIds: members.map(status => status.member.memberId) })
  const query = filters.query.trim().toLowerCase()
  const visibleMembers = orderedMembers.filter(status => {
    if (query !== '' && !status.member.handle.toLowerCase().includes(query) && !status.member.description.toLowerCase().includes(query)) return false
    if (filters.role !== 'all' && status.member.role !== filters.role) return false
    // The filter reads the same presence the row's dot draws, so a filter
    // choice and the dot can never disagree.
    if (filters.presence !== 'all' && presenceByMember.get(status.member.memberId)?.availability !== filters.presence) return false
    return true
  })

  return (
    <div className={css.panel}>
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('addAgent')}
        closeLabel={t('close')}
        contentClassName={createCss.dialogContent!}
        footer={<><Button variant="outline" disabled={creating} onClick={closeForm}>{t('cancel')}</Button>{!importing && <Button type="submit" form="team-agent-create-form" variant="primary" disabled={creating || handle.trim().length === 0}>{creating ? t('creatingAgent') : t('createAgent')}</Button>}</>}
      >
        <Button className={createCss.modeSwitch!} variant="outline" disabled={creating} aria-expanded={importing} onClick={() => { setImporting(value => !value); setError(undefined) }}>{importing ? t('createAgent') : t('importAgentTitle')}</Button>
        {formOpen && importing ? <TeamAgentImport workspaceId={workspaceId} loadMembers={loadMembers} joinWorkspace={joinWorkspace} onPending={setCreating} onJoined={async () => { await refresh(); setFormOpen(false); queueMicrotask(() => { triggerRef.current?.focus() }) }} t={t} /> : <form id="team-agent-create-form" className={createCss.form} onSubmit={submit}>
          <label className={createCss.field}>
            <span>{t('agentName')}</span>
            <Input className={createCss.input!} value={handle} onChange={event => { setHandle(event.target.value); setRetryRequest(undefined) }} disabled={creating} autoFocus />
          </label>
          <label className={createCss.field}>
            <span>{t('agentDescription')}{t('optionalSuffix')}</span>
            <Input className={createCss.input!} value={description} placeholder={t('agentDescriptionPlaceholder')} onChange={event => { setDescription(event.target.value); setRetryRequest(undefined) }} disabled={creating} />
          </label>
          <RoleField value={role} onChange={next => { setRole(next); setRetryRequest(undefined) }} disabled={creating} t={t} />
          <ModelPickerField model={model} onModelChange={choice => { setModel(choice); setRetryRequest(undefined) }} loadModels={loadModels} disabled={creating} t={t} />
          {formOpen && error !== undefined && <p className={createCss.error} role="alert">{error}</p>}
        </form>}
      </Modal>
      <TeamSidebarSection
        title={t('agents')}
        open={sectionOpen}
        onToggle={open => { setSidebarSectionOpen(workspaceId, 'agents', open) }}
        actions={(
          <Tooltip label={t('addAgent')} delayMs={500}>
            <button ref={triggerRef} type="button" className={css.iconButton} aria-label={t('addAgent')} onClick={() => { setError(undefined); setImporting(false); setFormOpen(true) }}>
              <IconPlusOutlineRegular size={14} />
            </button>
          </Tooltip>
        )}
      >
        {loading && members.length === 0 && <p className={css.emptyState}>{t('loadingAgents')}</p>}
        {/* `members` is empty both before the first successful load and after a
            failed one, so the empty claim additionally requires a clear error. */}
        {!loading && error === undefined && members.length === 0 && <p className={css.emptyState}>{t('emptyAgents')}</p>}
        {members.length > 0 && <AgentListToolbar filters={filters} onChange={setFilters} visible={visibleMembers.length} total={members.length} t={t} />}
        {members.length > 0 && visibleMembers.length === 0 && <p className={css.emptyState} data-agent-list-empty>{t('agentListEmptyFiltered')}</p>}
        <div className={css.agentList}>
          {visibleMembers.map(status => (
            <SortableRow key={status.member.memberId} drag={drag} orderKey={status.member.memberId}>
              <AgentRow workspaceId={workspaceId} leaveWorkspace={leaveWorkspace} status={status} {...(memberSessionId === undefined ? {} : { current: status.member.sessionId === memberSessionId })} activity={activities.find(item => item.memberId === status.member.memberId)} task={currentTaskOf(board, status.member.memberId, activities.find(item => item.memberId === status.member.memberId))} tokens={tokensToday(runsByMember.get(status.member.memberId) ?? [])} presence={presenceByMember.get(status.member.memberId)} updateMember={updateMember} recoverMember={recoverMember} archiveMember={archiveMember} loadModels={loadModels} openMemberSession={openMemberSession} openAgentDetail={openAgentDetail} onUpdated={refresh} t={t} />
            </SortableRow>
          ))}
        </div>
      </TeamSidebarSection>
      {!formOpen && error !== undefined && (
        <div className={css.retryError} role="alert">
          <span>{error}</span>
          {retryRequest !== undefined && <button type="button" className={css.textButton} disabled={creating} onClick={() => { setFormOpen(true) }}>{t('retry')}</button>}
        </div>
      )}
    </div>
  )
}

/**
 * One sidebar Agent row: the select button opens the Member's own Session
 * conversation page, the avatar carries identity plus the presence badge, and
 * the row menu opens the editor.
 */
function AgentRow({ workspaceId, leaveWorkspace, status, current, activity, task, tokens, presence, updateMember, recoverMember, archiveMember, loadModels, openMemberSession, openAgentDetail, onUpdated, t }: {
  readonly workspaceId: WorkspaceId
  readonly leaveWorkspace: TeamSidebarProps['leaveWorkspace']
  readonly status: AgentTeamClientMemberStatus
  /** This Member's Session is the one embedded in the conversation seat. */
  readonly current?: boolean
  readonly activity?: AgentTeamMemberActivity | undefined
  readonly task?: ReturnType<typeof currentTaskOf> | undefined
  readonly tokens: number
  readonly presence?: AgentPresenceDetail | undefined
  readonly updateMember: TeamSidebarProps['updateMember']
  readonly recoverMember: TeamSidebarProps['recoverMember']
  readonly archiveMember: TeamSidebarProps['archiveMember']
  readonly loadModels: TeamSidebarProps['loadModels']
  readonly openMemberSession: TeamSidebarProps['openMemberSession']
  readonly openAgentDetail: TeamSidebarProps['openAgentDetail']
  readonly onUpdated: () => Promise<void> | void
  readonly t: TeamSidebarProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [rowAlert, setRowAlert] = useState<string>()
  const [archivePending, setArchivePending] = useState(false)
  const archiveRequest = useRef<ReturnType<typeof mintRequestId>>()
  const withdrawing = workspaceId !== status.member.workspaceId
  // Both row actions ride the same runtime remote: the Host steers a live
  // session, rebuilds an orphaned composition, or re-runs a failed activation.
  // Copy the seat's Session id; the clipboard is optional in some hosts, so a refusal is shown, not thrown.
  const openDetail = (): void => {
    openAgentDetail(workspaceId, status.member.memberId, status.member.sessionId, message => {
      setRowAlert(t('openAgentSessionFailed', { name: status.member.handle.replace(/^@/, ''), message }))
    })
  }
  const copySessionId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(status.member.sessionId)
    } catch {
      setRowAlert(t('copySessionIdFailed'))
    }
  }

  const recover = async (): Promise<void> => {
    try {
      const result = await recoverMember({
        requestId: mintRequestId(),
        workspaceId: status.member.workspaceId,
        memberId: status.member.memberId,
      })
      await onUpdated()
      if (!result.ok) {
        setRowAlert(t('restartFailed', { message: result.error.message }))
        return
      }
      if (result.value.status.availability === 'unavailable') {
        setRowAlert(t('restartStillUnavailable', { diagnostic: diagnosticText(result.value.status) || t('statusUnavailable') }))
        return
      }
      setRowAlert(undefined)
      // A page opened while the Member was down predates the live Session;
      // re-selecting is a no-op when already bound and rebinds when stale.
      if (current === true) openMemberSession(status.member.sessionId)
    } catch (cause) {
      setRowAlert(t('restartFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }
  const archive = async (): Promise<void> => {
    if (archivePending) return
    setArchivePending(true)
    setRowAlert(undefined)
    archiveRequest.current ??= mintRequestId()
    const request = { requestId: archiveRequest.current, memberId: status.member.memberId }
    try {
      const result = withdrawing ? await leaveWorkspace({ ...request, workspaceId }) : await archiveMember(request)
      if (!result.ok) throw new Error(result.error.message)
      setArchiving(false)
      archiveRequest.current = undefined
      await onUpdated()
    } catch (cause) {
      setRowAlert(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setArchivePending(false)
    }
  }
  return (
    <>
      <div className={css.agentRow} data-agent-row data-menu-open={menuOpen || undefined}>
        <button type="button" className={css.agentSelect} aria-label={t('openAgentDetail', { name: status.member.handle })} aria-current={current ? 'page' : undefined} onClick={() => { openDetail() }}>
          <AgentRosterRow
            status={status}
            {...(activity === undefined ? {} : { activity })}
            {...(task === undefined ? {} : { task })}
            tokens={tokens}
            presence={presence ?? deriveAgentPresence({ status, activities: activity === undefined ? [] : [activity] })}
            {...(current === true ? { current } : {})}
            t={t}
          />
        </button>
        <span className={css.rowMenu}>
          <TeamRowMenu
            label={t('actionsAgent', { name: status.member.handle })}
            items={[
              { id: 'edit', label: t('editAgent'), icon: <IconEditOutlineRegular /> },
              { id: 'copySession', label: t('copySessionId'), icon: <IconCopyOutlineRegular /> },
              { id: 'details', label: t('agentDetails'), icon: <IconClockOutlineRegular /> },
              { id: 'openSession', label: t('openCurrentSession'), icon: <IconPlayOutlineRegular />, disabled: status.availability !== 'active' },
              ...(status.presence === 'error' ? [{ id: 'resume', label: t('resumeAgent'), icon: <IconPlayOutlineRegular /> }] : []),
              ...(status.availability === 'unavailable' && restartOffered(status) ? [{ id: 'restart', label: t('restartAgent'), icon: <IconRefreshOutlineRegular /> }] : []),
              { id: 'archive', label: t(withdrawing ? 'withdrawAgent' : 'archiveAgent'), icon: <IconArchiveOutlineRegular size={16} />, danger: true },
            ]}
            onSelect={(id) => {
              if (id === 'edit') setEditing(true)
              else if (id === 'copySession') void copySessionId()
              else if (id === 'details') openDetail()
              else if (id === 'openSession') {
                openMemberSession(status.member.sessionId, message => {
                  setRowAlert(t('openAgentSessionFailed', { name: status.member.handle.replace(/^@/, ''), message }))
                })
              }
              else if (id === 'archive') setArchiving(true)
              else void recover()
            }}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
      {!archiving && rowAlert !== undefined && <div className={css.rowAlert} role="alert">{rowAlert}</div>}
      {archiving && (
        <Modal
          open
          onClose={() => { if (!archivePending) setArchiving(false) }}
          title={t(withdrawing ? 'withdrawAgentTitle' : 'archiveAgentTitle', { name: status.member.handle })}
          closeLabel={t('close')}
          contentClassName={createCss.dialogContent!}
          footer={<>
            <Button variant="outline" disabled={archivePending} onClick={() => { setArchiving(false) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={archivePending} onClick={() => { void archive() }}>{t(withdrawing ? 'withdrawAgent' : 'archiveAgentConfirm')}</Button>
          </>}
        >
          <p className={createCss.error}>{t(withdrawing ? 'withdrawAgentNotice' : 'archiveAgentNotice', { name: status.member.handle })}</p>
          {!withdrawing && status.workspaceIds.length > 1 && <p>{t('archiveOtherWorkspaces', { count: status.workspaceIds.length - 1 })}</p>}
          {rowAlert !== undefined && <p className={createCss.error} role="alert">{rowAlert}</p>}
        </Modal>
      )}
      {editing && (
        <AgentEditorDialog
          status={status}
          updateMember={updateMember}
          loadModels={loadModels}
          onCommitted={onUpdated}
          onClose={() => { setEditing(false) }}
          t={t}
        />
      )}
    </>
  )
}
