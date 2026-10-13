/**
 * The Human's Memory page (memory M3): a section of Team Settings under the
 * same Workspace selector as Agents.
 *
 * Record text is Team data. Titles, bodies, attrs and version history render
 * as plain React text — never HTML, never markdown — so a body that holds
 * markup or a `</team-memory>` marker shows as the characters it is.
 *
 * Every write goes through one Host method that adds the Human actor itself;
 * nothing here names an actor or a scope. A write names the version it was
 * shown; a CONFLICT reloads the record and says so instead of retrying.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamMemoryAction, AgentTeamMemoryActRequest, AgentTeamMemoryListRequest,
  AgentTeamMemoryOutcome, AgentTeamMemoryRecordRequest, AgentTeamMemoryRecordView, AgentTeamMemorySettingsRequest, AgentTeamMemoryWorkspaceRequest,
  AgentTeamTaskRef, TeamMemoryHomeKind, TeamMemoryRecord, TeamMemorySearchResult, TeamMemorySettings, TeamMemoryType, TeamMemoryUsage, TeamMemoryVersion,
} from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamSidebarProps } from './slots.ts'
import css from './memory.module.css'

type Remote<Request, Value> = (request: Request) => Promise<RemoteResult<AgentTeamMemoryOutcome<Value>>>

/** The Host's Human memory methods, as the page calls them. */
export interface TeamMemoryRemotes {
  readonly list: Remote<AgentTeamMemoryListRequest, TeamMemorySearchResult>
  readonly record: Remote<AgentTeamMemoryRecordRequest, AgentTeamMemoryRecordView>
  readonly ruleFeed: Remote<AgentTeamMemoryWorkspaceRequest, readonly TeamMemoryVersion[]>
  readonly usage: Remote<AgentTeamMemoryWorkspaceRequest, TeamMemoryUsage>
  readonly settings: Remote<AgentTeamMemoryWorkspaceRequest, TeamMemorySettings>
  readonly updateSettings: Remote<AgentTeamMemorySettingsRequest, TeamMemorySettings>
  readonly act: Remote<AgentTeamMemoryActRequest, TeamMemoryRecord>
  /** The Channel name each Task sits in, for the task picture; unknown Tasks are left out. */
  readonly taskChannels: (workspaceId: WorkspaceId, taskRefs: readonly AgentTeamTaskRef[]) => Promise<Readonly<Record<string, string>>>
}

export interface TeamMemoryPanelProps {
  readonly workspaceId: WorkspaceId
  readonly memory: TeamMemoryRemotes
  readonly loadMembers: TeamSidebarProps['loadMembers']
  readonly t: TeamSidebarProps['t']
}

type Outcome<T> = AgentTeamMemoryOutcome<T>
type View = 'records' | 'tasks' | 'feed' | 'usage' | 'settings'

const TYPES: readonly TeamMemoryType[] = ['rule', 'decision', 'convention', 'how_to_work', 'task', 'branch']
const HOMES: readonly TeamMemoryHomeKind[] = ['team', 'channel', 'task', 'expert']
/** Types the Team always sees, wherever they are homed (design v5 §2). */
const TEAM_VISIBLE: ReadonlySet<string> = new Set(['decision', 'task', 'branch'])
const UNAVAILABLE: ReadonlySet<string> = new Set(['BACKEND_UNAVAILABLE', 'MEMORY_UNSUPPORTED'])

/** Fold a transport failure, thrown or rejected, into the same outcome shape as a backend refusal. */
async function settle<T>(call: () => Promise<RemoteResult<Outcome<T>>>): Promise<Outcome<T>> {
  try {
    const result = await call()
    return result.ok ? result.value : { ok: false, code: 'REMOTE', message: result.error.message }
  } catch (error) {
    return { ok: false, code: 'REMOTE', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Status words a reader acts on: a full home and the human gate are spelled
 * out. A pending team rule always waits for the Human (the Human's own team
 * rules are live at once), whoever approved it into the queue.
 */
export function memoryStatusLabel(record: Pick<TeamMemoryRecord, 'status' | 'flag' | 'type' | 'home'>, t: TeamMemoryPanelProps['t']): string {
  if (record.flag === 'blocked_budget') return t('memoryBlockedBudget', { status: record.status })
  if (record.status === 'pending' && record.type === 'rule' && record.home.kind === 'team') return t('memoryNeedsHuman')
  return record.status
}

export function TeamMemoryPanel({ workspaceId, memory, loadMembers, t }: TeamMemoryPanelProps) {
  const [view, setView] = useState<View>('records')
  const [unavailable, setUnavailable] = useState<string>()
  const onOutcome = useCallback(<T,>(outcome: Outcome<T>): Outcome<T> => {
    if (!outcome.ok && UNAVAILABLE.has(outcome.code)) setUnavailable(outcome.message)
    return outcome
  }, [])
  const views = [
    ['records', t('memoryViewRecords')], ['tasks', t('memoryViewTasks')], ['feed', t('memoryViewFeed')],
    ['usage', t('memoryViewUsage')], ['settings', t('memoryViewSettings')],
  ] as const satisfies readonly (readonly [View, string])[]

  return <section className={css.memory} aria-label={t('memorySection')} data-team-memory>
    <h3 className={css.heading}>{t('memorySection')}</h3>
    <p className={css.intro}>{t('memoryIntro')}</p>
    {unavailable !== undefined
      ? <p className={css.unavailable} role="status">{t('memoryUnavailable', { message: unavailable })}</p>
      : <>
        <div className={css.views} role="tablist">
          {views.map(([entry, label]) => <button key={entry} type="button" role="tab" aria-selected={view === entry} className={css.viewTab} onClick={() => setView(entry)}>{label}</button>)}
        </div>
        {view === 'records' && <MemoryRecords key={workspaceId} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} t={t} />}
        {view === 'tasks' && <MemoryTaskPicture key={workspaceId} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} t={t} />}
        {view === 'feed' && <MemoryRuleFeed key={workspaceId} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} t={t} />}
        {view === 'usage' && <MemoryUsage key={workspaceId} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} t={t} />}
        {view === 'settings' && <MemorySettings key={workspaceId} workspaceId={workspaceId} memory={memory} loadMembers={loadMembers} onOutcome={onOutcome} t={t} />}
      </>}
  </section>
}

interface SectionProps {
  readonly workspaceId: WorkspaceId
  readonly memory: TeamMemoryRemotes
  readonly onOutcome: <T>(outcome: Outcome<T>) => Outcome<T>
  readonly t: TeamMemoryPanelProps['t']
}

function MemoryRecords({ workspaceId, memory, onOutcome, t }: SectionProps) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<TeamMemoryType | ''>('')
  const [home, setHome] = useState<TeamMemoryHomeKind | ''>('')
  const [status, setStatus] = useState<'live' | 'superseded' | 'retracted' | 'expired' | 'all'>('live')
  const [records, setRecords] = useState<readonly TeamMemoryRecord[]>()
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    const base = {
      workspaceId,
      ...(q.trim() === '' ? {} : { q: q.trim() }),
      ...(type === '' ? {} : { types: [type] }),
      ...(home === '' ? {} : { homes: [home] }),
      limit: 100,
    }
    // Live means pending first, then active: the queue the Human owes is on top.
    const statuses = status === 'live' ? ['pending', 'active'] as const : [status] as const
    void Promise.all(statuses.map(entry => settle(() => memory.list({ ...base, status: entry })).then(onOutcome))).then(outcomes => {
      if (!live) return
      const failed = outcomes.find(outcome => !outcome.ok)
      if (failed !== undefined && !failed.ok) { setError(failed.message); return }
      setError(undefined)
      setRecords(outcomes.flatMap(outcome => outcome.ok ? outcome.value.results : []))
    })
    return () => { live = false }
  }, [workspaceId, memory, onOutcome, q, type, home, status, reload])

  return <div className={css.records}>
    <div className={css.filters}>
      <Input value={q} onChange={event => setQ(event.target.value)} placeholder={t('memorySearch')} aria-label={t('memorySearch')} />
      <select aria-label={t('memoryFilterType')} value={type} onChange={event => setType(event.target.value as TeamMemoryType | '')}>
        <option value="">{t('memoryAnyType')}</option>
        {TYPES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
      </select>
      <select aria-label={t('memoryFilterHome')} value={home} onChange={event => setHome(event.target.value as TeamMemoryHomeKind | '')}>
        <option value="">{t('memoryAnyHome')}</option>
        {HOMES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
      </select>
      <select aria-label={t('memoryFilterStatus')} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
        <option value="live">{t('memoryStatusLive')}</option>
        <option value="superseded">superseded</option>
        <option value="retracted">retracted</option>
        <option value="expired">expired</option>
        <option value="all">{t('memoryStatusAll')}</option>
      </select>
    </div>
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    {records !== undefined && records.length === 0 && <p className={css.empty}>{t('memoryEmpty')}</p>}
    <ul className={css.list}>
      {records?.map(record => <MemoryRecordRow key={record.id} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} record={record} onChanged={() => setReload(value => value + 1)} t={t} />)}
    </ul>
  </div>
}

function recordHeadline(record: Pick<TeamMemoryRecord, 'type' | 'home' | 'version' | 'authorId'>): string {
  return `${record.type} · ${record.home.kind} ${record.home.ref} · v${record.version} · ${record.authorId}`
}

function MemoryRecordRow({ workspaceId, memory, onOutcome, record, onChanged, t }: SectionProps & { readonly record: TeamMemoryRecord; readonly onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<AgentTeamMemoryRecordView>()
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'purge' | 'widen' | 'edit'>()
  const shown = detail?.record ?? record

  const load = useCallback(async () => {
    const outcome = onOutcome(await settle(() => memory.record({ workspaceId, id: record.id })))
    if (outcome.ok) setDetail(outcome.value)
    else setNotice(outcome.message)
  }, [memory, onOutcome, workspaceId, record.id])

  useEffect(() => { if (open && detail === undefined) void load() }, [open, detail, load])

  const act = useCallback(async (action: AgentTeamMemoryAction) => {
    setBusy(true)
    const outcome = onOutcome(await settle(() => memory.act({ workspaceId, id: record.id, action })))
    setBusy(false)
    if (outcome.ok) {
      setNotice(undefined)
      setDialog(undefined)
      setDetail(undefined)
      onChanged()
      return true
    }
    if (outcome.code === 'CONFLICT') {
      // Never retried blindly: the reader sees the newer version first.
      setNotice(t('memoryConflict'))
      setDetail(undefined)
      await load()
    } else setNotice(t('memoryRefused', { code: outcome.code, message: outcome.message }))
    return false
  }, [memory, onOutcome, workspaceId, record.id, onChanged, load, t])

  const base = shown.version
  return <li className={css.record} data-memory-record={record.id}>
    <button type="button" className={css.recordHead} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className={css.status} data-status={shown.status}>{memoryStatusLabel(shown, t)}</span>
      <span className={css.title}>{shown.title ?? t('memoryUntitled')}</span>
      <span className={css.meta}>{recordHeadline(shown)}</span>
      {TEAM_VISIBLE.has(shown.type) && shown.home.kind !== 'team' && <span className={css.badge}>{t('memoryTeamVisible')}</span>}
      {shown.pinned && <span className={css.badge}>{t('memoryPinned')}</span>}
    </button>
    {notice !== undefined && <p className={css.notice} role="status">{notice}</p>}
    {open && <div className={css.detail}>
      {shown.body !== null && shown.body !== '' && <p className={css.body}>{shown.body}</p>}
      {shown.attrs !== null && <pre className={css.attrs}>{JSON.stringify(shown.attrs, null, 2)}</pre>}
      {detail !== undefined && detail.record.links.length > 0 && <ul className={css.links} aria-label={t('memoryLinks')}>
        {detail.record.links.map(link => <li key={`${link.kind}:${link.id}`}>{`${link.kind} → ${link.type} ${link.id}`}{link.title === null ? '' : ` — ${link.title}`}</li>)}
      </ul>}
      <div className={css.actions}>
        {shown.status === 'pending' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ verb: 'approve', baseVersion: base })}>{t('memoryApprove')}</Button>}
        {(shown.status === 'pending' || shown.status === 'active') && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ verb: 'retract', baseVersion: base })}>{t('memoryRetract')}</Button>}
        {shown.status === 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ verb: 'pin', baseVersion: base, pinned: !shown.pinned })}>{shown.pinned ? t('memoryUnpin') : t('memoryPin')}</Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog('edit')}>{t('memoryEdit')}</Button>
        {shown.home.kind !== 'team' && shown.home.kind !== 'expert' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog('widen')}>{t('memoryWiden')}</Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog('purge')}>{t('memoryPurge')}</Button>
      </div>
      {detail !== undefined && <ol className={css.versions} aria-label={t('memoryHistory')}>
        {detail.versions.map(entry => <li key={entry.version}>
          <span>{`v${entry.version} · ${entry.action} · ${entry.actorKind} ${entry.actorId} · ${entry.at}`}</span>
          {entry.reason !== null && entry.reason !== '' && <span className={css.meta}>{` — ${entry.reason}`}</span>}
          {entry.title !== null && <span className={css.versionText}>{entry.title}</span>}
          {entry.version !== shown.version && entry.action !== 'purge' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ verb: 'restore', baseVersion: base, version: entry.version })}>{t('memoryRestore')}</Button>}
        </li>)}
      </ol>}
    </div>}
    {dialog === 'purge' && <PurgeDialog record={shown} busy={busy} onCancel={() => setDialog(undefined)} onConfirm={confirm => void act({ verb: 'purge', confirm })} t={t} />}
    {dialog === 'widen' && <WidenDialog record={shown} busy={busy} onCancel={() => setDialog(undefined)} onConfirm={to => void act({ verb: 'widen', baseVersion: base, to, confirm: true })} t={t} />}
    {dialog === 'edit' && <EditDialog record={shown} busy={busy} onCancel={() => setDialog(undefined)} onSave={(title, body) => void act({ verb: 'edit', baseVersion: base, title, body })} t={t} />}
  </li>
}

/** Purge removes the text for good, so the reader types the title (or id) back before it is offered. */
export function PurgeDialog({ record, busy, onCancel, onConfirm, t }: {
  readonly record: TeamMemoryRecord; readonly busy: boolean; readonly onCancel: () => void; readonly onConfirm: (confirm: string) => void; readonly t: TeamMemoryPanelProps['t']
}) {
  const [typed, setTyped] = useState('')
  const expected = (record.title ?? '').trim()
  const matches = typed.trim() !== '' && (typed.trim() === expected || typed.trim() === record.id)
  return <Modal open onClose={onCancel} closeLabel={t('close')} title={t('memoryPurgeTitle')}>
    <p className={css.dialogText}>{t('memoryPurgeWarning')}</p>
    <p className={css.dialogText}>{t('memoryPurgeTypeBack')}</p>
    <p className={css.versionText}>{expected === '' ? record.id : expected}</p>
    <Input value={typed} onChange={event => setTyped(event.target.value)} aria-label={t('memoryPurgeConfirmLabel')} />
    <div className={css.actions}>
      <Button size="sm" variant="outline" onClick={onCancel}>{t('memoryCancel')}</Button>
      <Button size="sm" variant="outline" disabled={!matches || busy} onClick={() => onConfirm(typed.trim())}>{t('memoryPurge')}</Button>
    </div>
  </Modal>
}

/** Widen changes who sees a record and when it expires; the dialog says both before the explicit confirm. */
export function WidenDialog({ record, busy, onCancel, onConfirm, t }: {
  readonly record: TeamMemoryRecord; readonly busy: boolean; readonly onCancel: () => void; readonly onConfirm: (to: TeamMemoryHomeKind) => void; readonly t: TeamMemoryPanelProps['t']
}) {
  const targets: readonly TeamMemoryHomeKind[] = record.home.kind === 'task' ? ['channel', 'team'] : ['team']
  const [to, setTo] = useState<TeamMemoryHomeKind>(targets[targets.length - 1]!)
  const [confirmed, setConfirmed] = useState(false)
  return <Modal open onClose={onCancel} closeLabel={t('close')} title={t('memoryWidenTitle')}>
    <select aria-label={t('memoryWidenTo')} value={to} onChange={event => setTo(event.target.value as TeamMemoryHomeKind)}>
      {targets.map(entry => <option key={entry} value={entry}>{entry}</option>)}
    </select>
    <p className={css.dialogText} data-widen-expiry>{record.home.kind === 'task' ? t('memoryWidenExpiryTask') : t('memoryWidenExpiry')}</p>
    {record.type === 'rule' && to === 'team' && <p className={css.dialogText} data-widen-gate>{t('memoryWidenTeamRule')}</p>}
    <label className={css.confirm}>
      <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      {t('memoryWidenConfirm')}
    </label>
    <div className={css.actions}>
      <Button size="sm" variant="outline" onClick={onCancel}>{t('memoryCancel')}</Button>
      <Button size="sm" variant="outline" disabled={!confirmed || busy} onClick={() => onConfirm(to)}>{t('memoryWiden')}</Button>
    </div>
  </Modal>
}

function EditDialog({ record, busy, onCancel, onSave, t }: {
  readonly record: TeamMemoryRecord; readonly busy: boolean; readonly onCancel: () => void; readonly onSave: (title: string, body: string) => void; readonly t: TeamMemoryPanelProps['t']
}) {
  const [title, setTitle] = useState(record.title ?? '')
  const [body, setBody] = useState(record.body ?? '')
  return <Modal open onClose={onCancel} closeLabel={t('close')} title={t('memoryEditTitle')}>
    <Input value={title} onChange={event => setTitle(event.target.value)} aria-label={t('memoryFieldTitle')} />
    <textarea className={css.textarea} value={body} onChange={event => setBody(event.target.value)} aria-label={t('memoryFieldBody')} rows={6} />
    <div className={css.actions}>
      <Button size="sm" variant="outline" onClick={onCancel}>{t('memoryCancel')}</Button>
      <Button size="sm" variant="outline" disabled={busy || title.trim() === ''} onClick={() => onSave(title, body)}>{t('memorySave')}</Button>
    </div>
  </Modal>
}

/** Task records with their decisions and branches, grouped by the Channel each Task sits in. */
function MemoryTaskPicture({ workspaceId, memory, onOutcome, t }: SectionProps) {
  const [groups, setGroups] = useState<readonly { readonly channel: string; readonly tasks: readonly TeamMemoryRecord[] }[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    void settle(() => memory.list({ workspaceId, types: ['task'], status: 'active', limit: 100 })).then(onOutcome).then(async outcome => {
      if (!live) return
      if (!outcome.ok) { setError(outcome.message); return }
      const tasks = outcome.value.results
      const channels = await memory.taskChannels(workspaceId, tasks.map(task => task.home.ref as AgentTeamTaskRef)).catch(() => ({} as Readonly<Record<string, string>>))
      if (!live) return
      const byChannel = new Map<string, TeamMemoryRecord[]>()
      for (const task of tasks) {
        const channel = channels[task.home.ref] ?? t('memoryNoChannel')
        byChannel.set(channel, [...(byChannel.get(channel) ?? []), task])
      }
      setGroups([...byChannel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([channel, entries]) => ({ channel, tasks: entries })))
    })
    return () => { live = false }
  }, [workspaceId, memory, onOutcome, t])
  if (error !== undefined) return <p className={css.error} role="alert">{error}</p>
  if (groups !== undefined && groups.length === 0) return <p className={css.empty}>{t('memoryNoTasks')}</p>
  return <div className={css.records}>
    {groups?.map(group => <section key={group.channel} aria-label={group.channel}>
      <h4 className={css.groupHeading}>{group.channel}</h4>
      <ul className={css.list}>
        {group.tasks.map(task => <MemoryTaskRow key={task.id} workspaceId={workspaceId} memory={memory} onOutcome={onOutcome} task={task} t={t} />)}
      </ul>
    </section>)}
  </div>
}

function MemoryTaskRow({ workspaceId, memory, onOutcome, task, t }: SectionProps & { readonly task: TeamMemoryRecord }) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<AgentTeamMemoryRecordView['record']['links']>()
  useEffect(() => {
    if (!open || links !== undefined) return
    void settle(() => memory.record({ workspaceId, id: task.id })).then(onOutcome).then(outcome => setLinks(outcome.ok ? outcome.value.record.links : []))
  }, [open, links, memory, onOutcome, workspaceId, task.id])
  const state = typeof task.attrs?.['state'] === 'string' ? task.attrs['state'] : ''
  return <li className={css.record}>
    <button type="button" className={css.recordHead} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className={css.status}>{state}</span>
      <span className={css.title}>{task.title ?? task.home.ref}</span>
      <span className={css.meta}>{task.home.ref}</span>
    </button>
    {open && links !== undefined && (links.length === 0
      ? <p className={css.empty}>{t('memoryNoLinks')}</p>
      : <ul className={css.links}>{links.map(link => <li key={`${link.kind}:${link.id}`}>{`${link.kind} → ${link.type}`}{link.title === null ? '' : ` — ${link.title}`}</li>)}</ul>)}
  </li>
}

function MemoryRuleFeed({ workspaceId, memory, onOutcome, t }: SectionProps) {
  const [versions, setVersions] = useState<readonly TeamMemoryVersion[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    void settle(() => memory.ruleFeed({ workspaceId })).then(onOutcome).then(outcome => {
      if (!live) return
      if (outcome.ok) setVersions(outcome.value); else setError(outcome.message)
    })
    return () => { live = false }
  }, [workspaceId, memory, onOutcome])
  if (error !== undefined) return <p className={css.error} role="alert">{error}</p>
  if (versions !== undefined && versions.length === 0) return <p className={css.empty}>{t('memoryNoRuleChanges')}</p>
  return <ol className={css.versions} aria-label={t('memoryViewFeed')}>
    {versions?.map(entry => <li key={`${entry.memoryId}:${entry.version}`}>
      <span>{`${entry.at} · ${entry.action} · ${entry.status} · ${entry.homeKind} · ${entry.actorKind} ${entry.actorId}`}</span>
      <span className={css.versionText}>{entry.title ?? entry.memoryId}</span>
    </li>)}
  </ol>
}

function MemoryUsage({ workspaceId, memory, t }: SectionProps) {
  const [usage, setUsage] = useState<TeamMemoryUsage>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    void settle(() => memory.usage({ workspaceId })).then(outcome => {
      if (!live) return
      // An older backend without the usage route answers a bare 404: only this view says so,
      // and the rest of the page keeps working.
      if (outcome.ok) setUsage(outcome.value)
      else setError(UNAVAILABLE.has(outcome.code) ? t('memoryUsageUnavailable') : outcome.message)
    })
    return () => { live = false }
  }, [workspaceId, memory, t])
  if (error !== undefined) return <p className={css.error} role="status">{error}</p>
  if (usage !== undefined && usage.homes.length === 0) return <p className={css.empty}>{t('memoryNoUsage')}</p>
  return <ul className={css.list}>
    {usage?.homes.map(entry => <li key={`${entry.home.kind}:${entry.home.ref}`} className={css.usage}>
      <span className={css.title}>{`${entry.home.kind} ${entry.home.ref}`}</span>
      <meter min={0} max={usage.capTokens} value={entry.usedTokens} aria-label={t('memoryUsageMeter', { kind: entry.home.kind })} />
      <span className={css.meta}>{t('memoryUsageLine', { used: entry.usedTokens, cap: usage.capTokens, records: entry.records })}</span>
      {entry.blockedPending > 0 && <span className={css.badge}>{t('memoryUsageBlocked', { count: entry.blockedPending })}</span>}
    </li>)}
  </ul>
}

function MemorySettings({ workspaceId, memory, loadMembers, onOutcome, t }: SectionProps & { readonly loadMembers: TeamMemoryPanelProps['loadMembers'] }) {
  const [settings, setSettings] = useState<TeamMemorySettings>()
  const [agents, setAgents] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [bounds, setBounds] = useState<TeamMemoryUsage['injectLayerTokens']>()
  const [tokens, setTokens] = useState('')
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    let live = true
    void settle(() => memory.settings({ workspaceId })).then(onOutcome).then(outcome => {
      if (!live) return
      if (outcome.ok) { setSettings(outcome.value); setTokens(String(outcome.value.injectLayerTokens)) } else setMessage(outcome.message)
    })
    void settle(() => memory.usage({ workspaceId })).then(outcome => { if (live && outcome.ok) setBounds(outcome.value.injectLayerTokens) })
    void loadMembers({ workspaceId }).then(result => { if (live && result.ok) setAgents(result.value) })
    return () => { live = false }
  }, [workspaceId, memory, onOutcome, loadMembers])

  const save = useCallback(async (change: Omit<AgentTeamMemorySettingsRequest, 'workspaceId'>) => {
    const outcome = onOutcome(await settle(() => memory.updateSettings({ workspaceId, ...change })))
    if (outcome.ok) { setSettings(outcome.value); setMessage(t('memorySettingsSaved')) } else setMessage(t('memoryRefused', { code: outcome.code, message: outcome.message }))
  }, [memory, onOutcome, workspaceId, t])

  const orchestrators = useMemo(() => new Set(settings?.orchestrators ?? []), [settings])
  if (settings === undefined) return message === undefined ? null : <p className={css.error} role="alert">{message}</p>
  const tokensValue = Number(tokens)
  const tokensValid = Number.isInteger(tokensValue) && (bounds === undefined || (tokensValue >= bounds.min && tokensValue <= bounds.max))
  return <div className={css.settings}>
    <label className={css.settingRow}>
      <span>{t('memoryExpertApproval')}</span>
      <select value={settings.expertApproval} onChange={event => void save({ expertApproval: event.target.value as 'off' | 'required' })}>
        <option value="required">{t('memoryApprovalRequired')}</option>
        <option value="off">{t('memoryApprovalOff')}</option>
      </select>
    </label>
    <fieldset className={css.settingRow}>
      <legend>{t('memoryOrchestrators')}</legend>
      {agents.map(agent => {
        const memberId: AgentTeamMemberId = agent.member.memberId
        return <label key={memberId} className={css.confirm}>
          <input type="checkbox" checked={orchestrators.has(memberId)} onChange={event => {
            const next = new Set(orchestrators)
            if (event.target.checked) next.add(memberId); else next.delete(memberId)
            void save({ orchestrators: [...next] })
          }} />
          {`@${agent.member.handle}`}
        </label>
      })}
    </fieldset>
    <label className={css.settingRow}>
      <span>{t('memoryLayerTokens', bounds === undefined ? { min: '?', max: '?' } : { min: bounds.min, max: bounds.max })}</span>
      <Input value={tokens} inputMode="numeric" onChange={event => setTokens(event.target.value)} aria-label={t('memoryLayerTokensLabel')} />
      <Button size="sm" variant="outline" disabled={!tokensValid || tokensValue === settings.injectLayerTokens} onClick={() => void save({ injectLayerTokens: tokensValue })}>{t('memorySave')}</Button>
    </label>
    {message !== undefined && <p className={css.notice} role="status">{message}</p>}
  </div>
}
