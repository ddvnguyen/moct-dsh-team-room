import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react'
import type { AgentTeamClientMemberStatus, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { IconChecklistOutlineMedium, IconPaperclipOutlineMedium, IconSendOutlineRegular, rankByName, Tooltip, useAnchoredMaxHeight, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from './slots.ts'
import type { TeamDraftKey, TeamDraftStore } from './drafts.ts'
import type { TeamTriggerCatalogItem } from './trigger-catalog.ts'
import { TeamPresenceDot } from './TeamPresenceDot.tsx'
import { allMentionMembers, containsAllMention, containsMention, mentionedMemberIds } from './team-formatters.ts'
import css from './composer.module.css'
import { formatByteSize } from './attachment-preview.ts'

interface MentionMatch {
  readonly start: number
  readonly end: number
  readonly query: string
}

interface TriggerMatch {
  readonly start: number
  readonly end: number
  readonly query: string
}

/** One pickable row: the fixed @all expansion or one concrete member. */
type MentionOption = { readonly kind: 'all' } | { readonly kind: 'member'; readonly status: AgentTeamClientMemberStatus }

function findMention(draft: string, caret: number): MentionMatch | undefined {
  const beforeCaret = draft.slice(0, caret)
  if (beforeCaret.length === 0 || /\s/u.test(beforeCaret.at(-1) ?? '')) return undefined
  let tokenStart = beforeCaret.length
  while (tokenStart > 0 && !/\s/u.test(beforeCaret[tokenStart - 1]!)) tokenStart -= 1
  const at = beforeCaret.lastIndexOf('@')
  if (at < tokenStart) return undefined
  if (at > 0 && /[\p{L}\p{N}_]/u.test(beforeCaret[at - 1]!)) return undefined
  return { start: at, end: caret, query: beforeCaret.slice(at + 1) }
}

function findSlashTrigger(draft: string, caret: number): TriggerMatch | undefined {
  const beforeCaret = draft.slice(0, caret)
  if (beforeCaret.length === 0 || /\s/u.test(beforeCaret.at(-1) ?? '')) return undefined
  let tokenStart = beforeCaret.length
  while (tokenStart > 0 && !/\s/u.test(beforeCaret[tokenStart - 1]!)) tokenStart -= 1
  const slash = beforeCaret.lastIndexOf('/')
  if (slash < tokenStart) return undefined
  if (slash > 0 && /[\p{L}\p{N}_]/u.test(beforeCaret[slash - 1]!)) return undefined
  return { start: slash, end: caret, query: beforeCaret.slice(slash + 1) }
}

function matchingTriggerGroups(catalog: readonly TeamTriggerCatalogItem[], match: TriggerMatch, draft: string) {
  const atDraftStart = /^\s*$/u.test(draft.slice(0, match.start))
  const eligible = catalog.filter(item => atDraftStart || item.leadingOnly !== true)
  return {
    commands: rankByName(eligible.filter(item => item.kind === 'command'), match.query),
    skills: rankByName(eligible.filter(item => item.kind === 'skill'), match.query),
    notices: eligible.filter(item => item.kind === 'notice'),
  }
}

function mentionCandidates(members: readonly AgentTeamClientMemberStatus[], query: string): readonly AgentTeamClientMemberStatus[] {
  const normalized = query.toLocaleLowerCase()
  return members.filter(status => status.presence !== 'unavailable'
    && status.member.state !== 'inactive'
    && status.member.state !== 'archived'
    && status.member.handle.toLocaleLowerCase().startsWith(normalized))
}

/** Thread followers rank first: mentioning them delivers directly, while a non-follower enters the two-send invite flow. */
function rankMentionCandidates(candidates: readonly AgentTeamClientMemberStatus[], followers: ReadonlySet<AgentTeamMemberId> | undefined): readonly AgentTeamClientMemberStatus[] {
  if (followers === undefined || followers.size === 0) return candidates
  return [...candidates].sort((left, right) => Number(followers.has(right.member.memberId)) - Number(followers.has(left.member.memberId)))
}

/** One object URL per draft file; revoked when the draft is removed. */
const draftPreviewUrls = new WeakMap<File, string>()

function draftPreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined
  let url = draftPreviewUrls.get(file)
  if (url === undefined) {
    url = URL.createObjectURL(file)
    draftPreviewUrls.set(file, url)
  }
  return url
}

/**
 * The composer's selected agent: a Member id never survives a reload (human
 * rule 3273) and never outlives its scope, so it is derived state — the stored
 * id when it still names a Member of the current Channel/Thread, otherwise the
 * first member. Nothing is persisted, and a scope change (or a roster that
 * dropped the pick) falls back on the next render rather than staying stale.
 */
function selectedMemberId(members: readonly AgentTeamClientMemberStatus[], stored: AgentTeamMemberId | undefined): AgentTeamMemberId | undefined {
  if (members.length === 0) return undefined
  if (stored !== undefined && members.some(status => status.member.memberId === stored)) return stored
  return members[0]!.member.memberId
}

export function TeamComposer({ members, followerMemberIds, drafts, loadTriggerCatalog, draftKey, pending, confirmation, error, onEdit, onSubmit, placeholder, pendingFiles, onFilesChange, replyTo, onCancelReply, humanMemberId, asTask, onAsTaskChange, activity, t }: {
  readonly members: readonly AgentTeamClientMemberStatus[]
  /** Current Thread followers; the Thread surface passes them so they rank above other candidates. */
  readonly followerMemberIds?: ReadonlySet<AgentTeamMemberId>
  /**
   * The draft cache this composer subscribes to: owning the subscription here
   * instead of in the hosting page keeps a keystroke from re-rendering the
   * timeline around it.
   */
  readonly drafts: TeamDraftStore
  readonly loadTriggerCatalog: TeamConversationProps['loadTriggerCatalog']
  readonly draftKey: TeamDraftKey
  readonly pending: boolean
  readonly confirmation?: string
  readonly error?: string
  /** The Human edited the draft: the hosting page drops its one-shot send state. */
  readonly onEdit?: () => void
  readonly onSubmit: () => void
  /** Conversation-specific prompt; the shared default fits Channel surfaces. */
  readonly placeholder?: string
  /** Upload-capable surfaces pass this to enable the "+" file picker; the reply path omits it. */
  readonly pendingFiles?: readonly File[]
  readonly onFilesChange?: (files: readonly File[]) => void
  /**
   * The Message this send answers. Present, the composer states what is being
   * answered and offers a way out: a quote the reader cannot cancel would ride
   * the next Enter after they had moved past it. `memberId` lets the author join
   * the ordinary "will notify" row; it is absent when the parent did not resolve.
   */
  readonly replyTo?: { readonly memberId?: AgentTeamMemberId; readonly senderName: string; readonly excerpt: string } | undefined
  readonly onCancelReply?: (() => void) | undefined
  /** The writing Human's Member id, from the page's Team view: a quote of their own Message notifies no one. */
  readonly humanMemberId?: AgentTeamMemberId | undefined
  /** Channel-only: create a real Task with the top-level Message. Default off. */
  readonly asTask?: boolean
  readonly onAsTaskChange?: (asTask: boolean) => void
  /** A13 activity line, overlaid directly above the card (see TeamActivityLine). */
  readonly activity?: ReactNode
  readonly t: TeamConversationProps['t']
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)
  const pasteSuppressesSlashRef = useRef(false)
  const pasteResetRef = useRef<ReturnType<typeof setTimeout>>()
  // The draft lives in the injected cache so a view switch or refresh does not
  // cost the half-written message. Subscribing here — not in the page that
  // hosts this composer — is what keeps a keystroke off the timeline.
  const { draft, recipients } = useSyncExternalStore(drafts.subscribe, () => drafts.getSnapshot(draftKey))
  const [mention, setMention] = useState<MentionMatch>()
  const [trigger, setTrigger] = useState<TriggerMatch>()
  const [triggerCatalog, setTriggerCatalog] = useState<readonly TeamTriggerCatalogItem[] | null>(null)
  // The selected agent for the slash-trigger skills and the indicator chip.
  // Derived from the roster: a stored id that left this scope is dropped, so a
  // Channel/Thread switch can never keep a stale pick on screen.
  const [pickedMemberId, setPickedMemberId] = useState<AgentTeamMemberId>()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [triggerCatalogError, setTriggerCatalogError] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [triggerHighlight, setTriggerHighlight] = useState(0)
  // @all is a composer-layer expansion of the same eligibility filter a
  // handle pick uses; the fixed row stays on top of the matching members.
  const memberCandidates = mention === undefined ? [] : rankMentionCandidates(mentionCandidates(members, mention.query), followerMemberIds)
  const options: readonly MentionOption[] = mention !== undefined && 'all'.startsWith(mention.query.toLocaleLowerCase())
    ? [{ kind: 'all' }, ...memberCandidates.map(status => ({ kind: 'member' as const, status }))]
    : memberCandidates.map(status => ({ kind: 'member' as const, status }))
  const menuOpen = mention !== undefined && options.length > 0
  const activeOption = options[highlight]
  const activeOptionKey = activeOption === undefined ? undefined : activeOption.kind === 'all' ? 'all' : activeOption.status.member.memberId
  const triggerMenuOpen = trigger !== undefined
  const triggerGroups = trigger === undefined || triggerCatalog === null ? { commands: [], skills: [], notices: [] } : matchingTriggerGroups(triggerCatalog, trigger, draft)
  // The selected agent, resolved against this scope's roster every render: a
  // pick that is no longer a member here falls back to the first member rather
  // than lingering as a dead selection.
  const currentMemberId = selectedMemberId(members, pickedMemberId)
  const selectedMember = members.find(status => status.member.memberId === currentMemberId)
  const triggerOptions = [...triggerGroups.commands, ...triggerGroups.skills].filter(item => item.kind !== 'notice')
  const activeTriggerOption = triggerOptions[triggerHighlight]
  const triggerListId = 'team-trigger-suggestions'
  const allCount = allMentionMembers(members).length
  const listId = 'team-mention-suggestions'
  const suggestionOpen = menuOpen || triggerMenuOpen
  const activeSuggestionKey = menuOpen ? activeOptionKey : activeTriggerOption === undefined ? undefined : activeTriggerOption.kind + ':' + activeTriggerOption.name
  const menuMaxHeight = useAnchoredMaxHeight(menuRef, 320, suggestionOpen ? draft : null)

  useDismissOnOutsidePointer(rootRef, suggestionOpen, open => {
    if (!open) { setMention(undefined); setTrigger(undefined) }
  })
  // The agent picker is a row-local menu inside the same root: an outside
  // pointer closes it without touching the draft menus.
  useDismissOnOutsidePointer(agentMenuRef, agentMenuOpen, open => { if (!open) setAgentMenuOpen(false) })

  useLayoutEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`
  }, [draft])

  useEffect(() => {
    if (mention === undefined || options.length === 0) {
      setHighlight(0)
      return
    }
    setHighlight(current => Math.min(current, options.length - 1))
  }, [mention, options.length])

  useEffect(() => {
    if (trigger === undefined || triggerOptions.length === 0) {
      setTriggerHighlight(0)
      return
    }
    setTriggerHighlight(current => Math.min(current, triggerOptions.length - 1))
  }, [trigger, triggerOptions.length])

  // The anchored height cap keeps long rosters scrollable; without this the
  // keyboard-highlighted row can stay hidden below the fold.
  useLayoutEffect(() => {
    if (!suggestionOpen) return
    // Optional call: jsdom renders the menu without a layout engine.
    activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [suggestionOpen, highlight, triggerHighlight, activeSuggestionKey])

  // The catalog is scoped to the selected agent, so changing the selection
  // reloads it: each Member's skills ride that Member's own session. The
  // callback keys on the two facts that scope it, so a roster refresh that
  // leaves the pick untouched does not re-read the catalogs.
  const memberSessionId = selectedMember?.member.sessionId
  const memberHandle = selectedMember === undefined ? '' : selectedMember.member.handle.replace(/^@/, '')
  const loadCatalog = useCallback((signal: AbortSignal) => loadTriggerCatalog({ sessionId: memberSessionId, memberHandle }, signal), [
    loadTriggerCatalog, memberSessionId, memberHandle,
  ])
  useEffect(() => {
    if (!triggerMenuOpen) return
    const controller = new AbortController()
    setTriggerCatalog(null)
    setTriggerCatalogError(false)
    void loadCatalog(controller.signal).then(catalog => {
      if (!controller.signal.aborted) setTriggerCatalog(catalog)
    }).catch(() => {
      if (!controller.signal.aborted) {
        setTriggerCatalog(null)
        setTriggerCatalogError(true)
      }
    })
    return () => { controller.abort() }
  }, [triggerMenuOpen, loadCatalog])

  useEffect(() => () => {
    if (pasteResetRef.current !== undefined) clearTimeout(pasteResetRef.current)
  }, [])

  // Match the resident DSH composer without stealing a later user choice: Team
  // data can load after navigation, so a dialog or another control may already
  // own focus by the time this composer appears.
  useEffect(() => {
    const active = document.activeElement
    if (active !== document.body && active?.closest('[aria-current="page"]') === null) return
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // Confirmation settles after a read-only submission span. Restore focus in
  // case the browser moved it so the second Enter can confirm immediately.
  useEffect(() => {
    if (confirmation === undefined || pending) return
    inputRef.current?.focus({ preventScroll: true })
  }, [confirmation, pending])

  // Handle lookup for both directions of the same judgement: whether a picked
  // recipient is still spelled in the text, and which Members the text names.
  const memberHandles = new Map(members.map(status => [status.member.memberId, status.member.handle]))

  const pruneRecipients = (nextDraft: string): void => {
    // An @all marker stands for its expansion snapshot: the member handles it
    // stands for are not in the text, so text-based pruning must stand down.
    if (containsAllMention(nextDraft)) return
    const next = new Set([...recipients].filter(memberId => {
      const handle = memberHandles.get(memberId)
      return handle !== undefined && containsMention(nextDraft, handle)
    }))
    if (next.size !== recipients.size) drafts.writeRecipients(draftKey, next)
  }

  // Restored drafts may carry recipients that no longer match the text (or
  // unknown Members); converge on mount and on every state change so the
  // cached entry never stays stale — the same rule user edits already apply.
  // An unloaded roster must never judge recipients unknown.
  useEffect(() => {
    if (members.length === 0) return
    pruneRecipients(draft)
  }, [draft, recipients, members])

  // The notify row reports what the Host will resolve from this draft, not just
  // what the mention menu picked: an authored `@Handle` delivers exactly like a
  // pick, and `@all` stands for the menu's expansion.
  // A quote's author belongs here too — the Host merges them into the
  // recipients — except the Human, who is the one writing through this composer.
  const notifiedIds = [...new Set<AgentTeamMemberId>([
    ...recipients,
    ...mentionedMemberIds(draft, members),
    ...(replyTo?.memberId === undefined || replyTo.memberId === humanMemberId ? [] : [replyTo.memberId]),
  ])].sort()

  const updateMention = (nextDraft: string, caret: number): void => {
    const match = findMention(nextDraft, caret)
    setMention(match)
    if (match === undefined) setHighlight(0)
  }

  const updateTrigger = (nextDraft: string, caret: number): void => {
    if (pasteSuppressesSlashRef.current) {
      setTrigger(undefined)
      return
    }
    const match = findSlashTrigger(nextDraft, caret)
    setTrigger(match)
    if (match === undefined) setTriggerHighlight(0)
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const nextDraft = event.target.value
    drafts.writeDraft(draftKey, nextDraft)
    onEdit?.()
    pruneRecipients(nextDraft)
    const caret = event.target.selectionStart ?? nextDraft.length
    updateMention(nextDraft, caret)
    updateTrigger(nextDraft, caret)
  }

  // A mention pick also updates recipients; slash picks only insert their literal trigger.
  const commitMention = (nextDraft: string, nextCaret: number, nextRecipients: ReadonlySet<AgentTeamMemberId>): void => {
    drafts.writeDraft(draftKey, nextDraft)
    drafts.writeRecipients(draftKey, nextRecipients)
    onEdit?.()
    setMention(undefined)
    setHighlight(0)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (input === null) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const selectTriggerOption = (option: TeamTriggerCatalogItem): void => {
    if (trigger === undefined) return
    const inserted = '/' + option.name + ' '
    const nextDraft = draft.slice(0, trigger.start) + inserted + draft.slice(trigger.end)
    const nextCaret = trigger.start + inserted.length
    drafts.writeDraft(draftKey, nextDraft)
    onEdit?.()
    setTrigger(undefined)
    setTriggerHighlight(0)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (input === null) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(nextCaret, nextCaret)
    })
  }
  const selectOption = (option: MentionOption): void => {
    if (mention === undefined) return
    if (option.kind === 'all') {
      // Expand at pick time: the recipients snapshot is every eligible member
      // a handle pick could reach at this moment.
      const nextDraft = `${draft.slice(0, mention.start)}@all ${draft.slice(mention.end)}`
      const nextCaret = mention.start + '@all '.length
      const nextRecipients = new Set(recipients)
      for (const status of allMentionMembers(members)) nextRecipients.add(status.member.memberId)
      commitMention(nextDraft, nextCaret, nextRecipients)
      return
    }
    const member = option.status
    const inserted = `@${member.member.handle} `
    const nextDraft = `${draft.slice(0, mention.start)}${inserted}${draft.slice(mention.end)}`
    const nextCaret = mention.start + inserted.length
    commitMention(nextDraft, nextCaret, new Set(recipients).add(member.member.memberId))
  }

  // Plain text paste remains native and must never open a slash suggestion menu.
  // Pasted files join the same chips the + picker fills.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (pending) return
    pasteSuppressesSlashRef.current = true
    if (pasteResetRef.current !== undefined) clearTimeout(pasteResetRef.current)
    pasteResetRef.current = setTimeout(() => {
      pasteSuppressesSlashRef.current = false
      pasteResetRef.current = undefined
    }, 0)
    setTrigger(undefined)
    if (onFilesChange === undefined || pendingFiles === undefined) return
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    onFilesChange([...pendingFiles, ...files])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const composing = composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
    if (menuOpen && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(current => (current + 1) % options.length)
      return
    }
    if (menuOpen && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(current => (current - 1 + options.length) % options.length)
      return
    }
    if (triggerMenuOpen && triggerOptions.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault()
      setTriggerHighlight(current => (current + 1) % triggerOptions.length)
      return
    }
    if (triggerMenuOpen && triggerOptions.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault()
      setTriggerHighlight(current => (current - 1 + triggerOptions.length) % triggerOptions.length)
      return
    }
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault()
      setMention(undefined)
      return
    }
    if (event.key === 'Escape' && triggerMenuOpen) {
      event.preventDefault()
      setTrigger(undefined)
      return
    }
    // Tab accepts the highlighted candidate; Shift+Tab keeps default focus reversal.
    if (menuOpen && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      if (activeOption !== undefined) selectOption(activeOption)
      return
    }
    if (triggerMenuOpen && event.key === 'Tab' && !event.shiftKey && activeTriggerOption !== undefined) {
      event.preventDefault()
      selectTriggerOption(activeTriggerOption)
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || composing || event.repeat) return
    if (triggerMenuOpen) {
      event.preventDefault()
      if (activeTriggerOption !== undefined) selectTriggerOption(activeTriggerOption)
      return
    }
    if (menuOpen && activeOption !== undefined) {
      event.preventDefault()
      selectOption(activeOption)
      return
    }
    event.preventDefault()
    if (!pending && draft.trim() !== '') onSubmit()
  }

  const triggerOptionId = (option: TeamTriggerCatalogItem, index: number): string => triggerListId + '-' + option.kind + '-' + option.name + '-' + index
  const renderTriggerOption = (option: TeamTriggerCatalogItem, index: number): ReactNode => {
    const selected = index === triggerHighlight
    return <button
      key={option.kind + ':' + option.name + ':' + index}
      id={triggerOptionId(option, index)}
      type="button"
      role="option"
      aria-selected={selected}
      className={css.mentionOption}
      ref={selected ? activeOptionRef : undefined}
      onMouseDown={event => { event.preventDefault() }}
      onClick={() => { selectTriggerOption(option) }}
    >
      <span className={css.mentionAllDot} aria-hidden="true" />
      <span className={css.mentionName}>/{option.name}</span>
      <span className={css.mentionDescription}>
        {option.kind === 'skill' && option.memberHandle !== undefined
          ? <span className={css.triggerOwner}>@{option.memberHandle}</span>
          : null}
        {option.description}
      </span>
    </button>
  }
  return <form ref={rootRef} className={css.root} onSubmit={event => {
    event.preventDefault()
    if (!pending && draft.trim() !== '') onSubmit()
  }}>
    {activity}
    <div className={css.card} data-team-composer>
      {replyTo !== undefined && <div className={css.replyBanner} data-reply-banner="">
        <span className={css.replyBannerBody}>
          <span className={css.replyBannerAuthor}>{t('replyingTo', { name: replyTo.senderName })}</span>
          <span className={css.replyBannerText}>{replyTo.excerpt}</span>
        </span>
        {onCancelReply !== undefined && <button type="button" className={css.replyBannerCancel} onClick={onCancelReply}
          aria-label={t('cancelReply')} title={t('cancelReply')}>×</button>}
      </div>}
      {confirmation !== undefined && <p className={css.confirmation} role="status">{confirmation}</p>}
      <div className={css.inputArea}>
        {triggerMenuOpen && <div id={triggerListId} ref={menuRef} className={css.mentionMenu} role="listbox" aria-label={t('triggerSuggestions')} style={{ maxHeight: menuMaxHeight }}>
          {triggerCatalogError ? <div className={css.triggerStatus} role="alert">{t('triggerCatalogUnavailable')}</div>
            : triggerCatalog === null ? <div className={css.triggerStatus} role="status">{t('triggerCatalogLoading')}</div>
            : triggerOptions.length === 0 ? <div className={css.triggerStatus} role="status">{trigger.query === '' ? t('triggerCatalogEmpty') : t('triggerNoResults')}</div>
            : <>
                {triggerGroups.commands.length > 0 && <div role="group" aria-label={t('triggerCommands')}>
                  <div className={css.triggerGroupHeading}>{t('triggerCommands')}</div>
                  {triggerGroups.commands.map((option, index) => renderTriggerOption(option, index))}
                </div>}
                {(triggerGroups.skills.length > 0 || triggerGroups.notices.length > 0) && <div role="group" aria-label={t('triggerSkills')}>
                  <div className={css.triggerGroupHeading}>{t('triggerSkills')}</div>
                  {triggerGroups.skills.map((option, index) => renderTriggerOption(option, triggerGroups.commands.length + index))}
                  {triggerGroups.notices.map(notice => <p key={notice.name} className={css.triggerNotice} data-trigger-notice={notice.name}>
                    {t('triggerNoMemberSession', { handle: notice.memberHandle ?? notice.description.replace(/^@/, '') })}
                  </p>)}
                </div>}
              </>}
        </div>}
        {menuOpen && <div id={listId} ref={menuRef} className={css.mentionMenu} role="listbox" aria-label={t('mentionSuggestions')} style={{ maxHeight: menuMaxHeight }}>
          {options.map((option, index) => {
            const optionId = option.kind === 'all' ? `${listId}-all` : `${listId}-${option.status.member.memberId}`
            const selected = index === highlight
            return option.kind === 'all'
              ? <button
                  key="all"
                  id={optionId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={css.mentionOption}
                  ref={selected ? activeOptionRef : undefined}
                  onMouseDown={event => { event.preventDefault() }}
                  onClick={() => { selectOption(option) }}
                >
                  <span className={css.mentionAllDot} aria-hidden="true" />
                  <span className={css.mentionName}>@all</span>
                  <span className={css.mentionDescription}>{t('mentionAll', { count: allCount })}</span>
                </button>
              : <button
                  key={option.status.member.memberId}
                  id={optionId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={css.mentionOption}
                  ref={selected ? activeOptionRef : undefined}
                  onMouseDown={event => { event.preventDefault() }}
                  onClick={() => { selectOption(option) }}
                >
                  <TeamPresenceDot status={option.status} t={t} />
                  <span className={css.mentionName}>@{option.status.member.handle}</span>
                  <span className={css.mentionDescription}>{option.status.member.description}</span>
                </button>
          })}
        </div>}
        <textarea
          ref={inputRef}
          aria-label={t('messageDraft')}
          aria-autocomplete="list"
          aria-controls={suggestionOpen ? (menuOpen ? listId : triggerListId) : undefined}
          aria-activedescendant={menuOpen && activeOption !== undefined ? activeOption.kind === 'all' ? `${listId}-all` : `${listId}-${activeOption.status.member.memberId}` : triggerMenuOpen && activeTriggerOption !== undefined ? triggerOptionId(activeTriggerOption, triggerHighlight) : undefined}
          aria-expanded={suggestionOpen}
          value={draft}
          readOnly={pending}
          placeholder={placeholder ?? t('messagePlaceholder')}
          rows={1}
          onChange={onChange}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onSelect={event => {
             const caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length
             updateMention(event.currentTarget.value, caret)
             updateTrigger(event.currentTarget.value, caret)
           }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { setTimeout(() => { composingRef.current = false }, 10) }}
        />
      </div>
      {notifiedIds.length > 0 && <p className={css.notifyRow} data-team-notify>{t('composerNotify', { ids: notifiedIds.map(memberId => `@${memberHandles.get(memberId) ?? memberId}`).join(', ') })}</p>}
      {onFilesChange !== undefined && pendingFiles !== undefined && pendingFiles.length > 0 && (
        <ul className={css.fileChips} aria-label={t('attachFiles')}>
          {pendingFiles.map((file, index) => {
            const previewUrl = draftPreviewUrl(file)
            return <li key={`${file.name}-${index}`} className={`${css.fileChip} ${previewUrl !== undefined ? css.imageChip! : ''}`}>
              {previewUrl !== undefined && <img src={previewUrl} alt="" className={css.imageChipPreview} />}
              <span className={css.fileChipName} title={file.name}>{file.name}<span className={css.fileChipSize}>{formatByteSize(file.size)}</span></span>
              <button type="button" className={css.fileChipRemove} aria-label={t('removeFile', { name: file.name })} disabled={pending}
                onClick={() => {
                  const url = draftPreviewUrls.get(file)
                  if (url !== undefined) URL.revokeObjectURL(url)
                  onFilesChange(pendingFiles.filter((_, candidate) => candidate !== index))
                }}>×</button>
            </li>
          })}
        </ul>
      )}
      <div className={css.agentRow}>
        {/* The selected agent is always on screen — with one agent in scope
            too, so a reader never has to guess whose skills the slash menu
            lists. The picker behind it lists this Channel/Thread's members. */}
        {selectedMember !== undefined && <span className={css.agentIndicator} role="status" data-team-agent-indicator={selectedMember.member.memberId} aria-label={t('agentIndicatorLabel', { handle: selectedMember.member.handle.replace(/^@/, '') })}>
          <TeamPresenceDot status={selectedMember} t={t} />
          <span className={css.agentIndicatorName}>@{selectedMember.member.handle.replace(/^@/, '')}</span>
        </span>}
        {members.length > 0 && <div className={css.agentPicker}>
          <button
            type="button"
            className={css.agentPickerButton}
            aria-label={t('selectAgent')}
            aria-haspopup="listbox"
            aria-expanded={agentMenuOpen}
            disabled={pending}
            onClick={() => { setAgentMenuOpen(open => !open) }}
          >
            <IconChecklistOutlineMedium size={14} />
            <span className={css.agentPickerLabel}>{t('selectAgent')}</span>
            <span className={css.agentPickerCurrent}>{selectedMember === undefined ? t('memberUnknown') : '@' + selectedMember.member.handle.replace(/^@/, '')}</span>
          </button>
          {agentMenuOpen && <div className={css.agentMenu} role="listbox" aria-label={t('selectAgent')} ref={agentMenuRef}>
            {members.map(status => {
              const chosen = status.member.memberId === currentMemberId
              return <button
                key={status.member.memberId}
                type="button"
                role="option"
                aria-selected={chosen}
                className={chosen ? `${css.agentOption} ${css.agentOptionOn}` : css.agentOption}
                onMouseDown={event => { event.preventDefault() }}
                onClick={() => {
                  setPickedMemberId(status.member.memberId)
                  setAgentMenuOpen(false)
                  // The catalog is scoped to the pick, so the open slash menu
                  // must reload against the new Member's session.
                  setTriggerCatalog(null)
                  inputRef.current?.focus({ preventScroll: true })
                }}
              >
                <TeamPresenceDot status={status} t={t} />
                <span className={css.agentOptionHandle}>@{status.member.handle.replace(/^@/, '')}</span>
                <span className={css.agentOptionDescription}>{status.member.description}</span>
              </button>
            })}
          </div>}
        </div>}
      </div>
      <div className={css.toolbar}>
        {onFilesChange !== undefined && (
          <>
            <input ref={fileInputRef} type="file" multiple className={css.fileInput} aria-hidden="true" tabIndex={-1}
              onChange={event => {
                const chosen = [...event.target.files ?? []]
                if (chosen.length > 0 && pendingFiles !== undefined) onFilesChange([...pendingFiles, ...chosen])
                event.target.value = ''
              }} />
            <Tooltip label={t('attachFiles')} side="top" delayMs={500}>
              <button type="button" className={css.attachButton} aria-label={t('attachFiles')}
                disabled={pending} onClick={() => { fileInputRef.current?.click() }}>
                <IconPaperclipOutlineMedium size={14} />
              </button>
            </Tooltip>
          </>
        )}
        {onAsTaskChange !== undefined && (
          <button
            type="button"
            className={asTask === true ? `${css.asTaskPill} ${css.asTaskPillOn}` : css.asTaskPill}
            aria-label={t('asTask')}
            aria-pressed={asTask === true}
            title={t('asTask')}
            disabled={pending}
            onClick={() => { onAsTaskChange(asTask !== true) }}
          >
            <IconChecklistOutlineMedium size={14} />
            <span className={css.asTaskLabel}>{t('asTask')}</span>
          </button>
        )}
        <button
          type="submit"
          className={css.sendButton}
          aria-label={pending ? t('sendingMessage') : t('sendMessage')}
          disabled={pending || draft.trim() === ''}
          onMouseDown={event => {
            // Keep the composer focused when the send control is clicked.
            event.preventDefault()
            inputRef.current?.focus({ preventScroll: true })
          }}
        >
          <IconSendOutlineRegular size={16} />
        </button>
      </div>
    </div>
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
  </form>
}
