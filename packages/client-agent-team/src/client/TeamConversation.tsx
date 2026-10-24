import { useSyncExternalStore } from 'react'
import type { TeamConversationProps } from './slots.ts'
import { useHumanIdentity } from './human-identity.ts'
import { TeamChannelPage } from './TeamChannelPage.tsx'
import { TeamBoardPage } from './board/TeamBoardPage.tsx'
import { TeamInboxPage } from './TeamInboxPage.tsx'
import { TeamThreadPage } from './TeamThreadPage.tsx'
import { TeamDocPage } from './TeamDocPage.tsx'
import { TeamLanes } from './TeamLanes.tsx'
import { IssuePage } from './issue/IssuePage.tsx'
import { jumpToTaskThread } from './refs.ts'
import css from './conversation.module.css'

export function TeamConversation({ t, useWorkspaces, navigation, drafts, humanIdentity, loadTriggerCatalog, putAttachment, getAttachment, loadChannels, readThread, loadThreadHistory, threadObservations, threadReplyStats, threadTurnFailures, loadThreadSessions, subscribeChanges, loadMembers, loadMemberActivity, loadInbox, loadBoard, loadIssueView, loadGitHubStatus, loadGitHubBoard, loadGitHubIssue, createGitHubIssue, updateGitHubIssue, commentGitHubIssue, createTask, updateTask, stopSession, sendMessage, joinChannel, removeChannelMember, archiveChannel, reply, changeTask, promoteThread, changeAttention, selectThread, selectChannel, selectWorkspace, backToWorkspace, backToChannels, back, closeIssue, openIssue, issueContext, setIssueVariant, resolveTaskRefs, resolveThreadRefs, resolveMessageRefs, loadDocs, loadDoc, commentDoc, reviewDoc, writeDocSection, resolveDocComment, loadDocSectionHistory, loadDecisions, answerDecision, selectDoc, openMemberSession, openSidebar, useSidebarCollapsed }: TeamConversationProps) {
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  // The open issue's context: the Workspace it is read in, and the control the
  // focus returns to. An Inbox row may name a Workspace the reader has not
  // selected, so the issue carries its own.
  const issueState = useSyncExternalStore(issueContext.subscribe, issueContext.get, issueContext.get)
  // Every seat names and draws the Human from this one projection: the
  // localized fallback stands only until the first profile read lands.
  const identity = useHumanIdentity(humanIdentity)
  // L1: one read of the shell column's collapse state feeds both headers; the
  // hook is called here so the two pages stay plain renderers of it.
  const sidebarCollapsed = useSidebarCollapsed()
  const humanName = identity.name ?? t('human')
  const workspaces = useWorkspaces(state => state.items)
  const current = workspaces.find(workspace => workspace.workspaceId === navigationState.workspaceId)
  if (navigationState.issueRef !== undefined && navigationState.issueVariant === 'page') {
    // The issue page is the whole column, over the face the reader is on: the
    // face flags are untouched, so closing the issue returns to the face the
    // reader came from. The slice dialog over the live face is M-38's chrome;
    // the slot that carries the issue is this client's.
    //
    // The Workspace is the one the issue was opened in — an Inbox row may name
    // a Workspace the reader has not selected, and the page must read the
    // issue there all the same.
    const issueWorkspaceId = issueState?.taskRef === navigationState.issueRef ? issueState.workspaceId : current?.workspaceId
    if (issueWorkspaceId === undefined) return null
    const issueRef = navigationState.issueRef
    return <IssuePage key={`issue:${issueRef}`} workspaceId={issueWorkspaceId} taskRef={issueRef}
      loadIssueView={loadIssueView} loadMembers={loadMembers} loadChannels={loadChannels} humanName={humanName}
      loadThreadHistory={loadThreadHistory} reply={reply} putAttachment={putAttachment} getAttachment={getAttachment}
      resolveMessageRefs={resolveMessageRefs} drafts={drafts} loadTriggerCatalog={loadTriggerCatalog}
      updateTask={updateTask} changeTask={changeTask} answerDecision={answerDecision}
      loadThreadSessions={loadThreadSessions} loadMemberActivity={loadMemberActivity} threadTurnFailures={threadTurnFailures}
      openMemberSession={openMemberSession} stopSession={stopSession} subscribeChanges={subscribeChanges}
      closeIssue={closeIssue} showSlice={() => { setIssueVariant('slice') }}
      goToThread={() => {
        // The issue closes first: the Thread is a face of its own, and the
        // issue slot is an overlay over whatever face the reader was on.
        closeIssue()
        jumpToTaskThread(resolveTaskRefs, issueWorkspaceId, issueRef, selectThread)
      }}
      t={t} />
  }
  if (current !== undefined && navigationState.board === true) {
    // The Board page is a Workspace face: the columns read the Workspace's
    // whole catalog, so it needs the selected Workspace. Selecting the Board
    // clears the Channel/Thread faces, and a card pick hands the seat to the
    // Thread setters like every other face change.
    return <TeamBoardPage key="board" workspaceId={current.workspaceId} loadBoard={loadBoard} loadMembers={loadMembers} loadMemberActivity={loadMemberActivity} loadGitHubStatus={loadGitHubStatus} loadGitHubBoard={loadGitHubBoard} loadGitHubIssue={loadGitHubIssue} createGitHubIssue={createGitHubIssue} updateGitHubIssue={updateGitHubIssue} commentGitHubIssue={commentGitHubIssue} createTask={createTask} updateTask={updateTask} changeTask={changeTask} subscribeChanges={subscribeChanges} openIssue={openIssue} navigation={navigation} t={t} />
  }
  if (navigationState.inbox === true) {
    // The Inbox page is global: it merges every visible Workspace and needs no
    // selected Workspace. Selecting Inbox clears the Channel/Thread faces, so
    // this face owns the seat while the flag stands. The Human identity rides
    // along for the same reason it rides on the other two faces: a row that
    // names or draws the reader must draw the one identity every seat draws.
    // The severity derivation's Remotes ride with it: the decision cards and
    // Turn failures that lift a row into the action-required band, the roster
    // the detail pane names actors from, and the read/unfollow Remotes the
    // pane's actions speak.
    return <TeamInboxPage key="inbox" useWorkspaces={useWorkspaces} loadInbox={loadInbox} loadMembers={loadMembers} loadDecisions={loadDecisions} answerDecision={answerDecision} threadTurnFailures={threadTurnFailures} readThread={readThread} changeAttention={changeAttention} subscribeChanges={subscribeChanges} selectWorkspace={selectWorkspace} selectThread={selectThread} openIssue={openIssue} humanName={humanName} {...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl })} t={t} />
  }
  if (current !== undefined && navigationState.threadRef !== undefined && navigationState.docRef !== undefined) {
    const { threadRef, channelRef, taskRef, taskNumber } = navigationState
    return <TeamDocPage key={navigationState.docRef} workspaceId={current.workspaceId} docRef={navigationState.docRef} threadRef={threadRef} humanName={humanName}
      loadDoc={loadDoc} commentDoc={commentDoc} reviewDoc={reviewDoc} writeDocSection={writeDocSection} resolveDocComment={resolveDocComment} loadDocSectionHistory={loadDocSectionHistory} loadMembers={loadMembers} subscribeChanges={subscribeChanges}
      backToThread={() => { if (!back()) selectThread(threadRef, channelRef, taskRef, taskNumber) }} sidebarCollapsed={sidebarCollapsed} openSidebar={openSidebar} t={t} />
  }
  if (current !== undefined && (navigationState.threadRef !== undefined || navigationState.channelRef !== undefined)) {
    // The Channel and its open Thread share one seat: side by side when it is
    // wide enough, the Thread alone when it is not (see `TeamLanes`).
    const { channelRef, threadRef } = navigationState
    return <TeamLanes key={current.workspaceId} closeThread={backToWorkspace} t={t}
      {...(channelRef === undefined ? {} : { channel: <TeamChannelPage key={channelRef} loadDocs={loadDocs} selectDoc={selectDoc} reviewDoc={reviewDoc} humanName={humanName} {...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl })} workspaceId={current.workspaceId} channelRef={channelRef} drafts={drafts} putAttachment={putAttachment} getAttachment={getAttachment} loadChannels={loadChannels} loadTriggerCatalog={loadTriggerCatalog} subscribeChanges={subscribeChanges} loadMembers={loadMembers} loadMemberActivity={loadMemberActivity} loadInbox={loadInbox} sendMessage={sendMessage} joinChannel={joinChannel} removeChannelMember={removeChannelMember} archiveChannel={archiveChannel} selectThread={selectThread} selectChannel={selectChannel} backToChannels={backToChannels} resolveTaskRefs={resolveTaskRefs} resolveThreadRefs={resolveThreadRefs} openMemberSession={openMemberSession} openSidebar={openSidebar} sidebarCollapsed={sidebarCollapsed} {...(navigationState.threadRef === undefined ? {} : { openThreadRef: navigationState.threadRef })} t={t} /> })}
      {...(threadRef === undefined ? {} : { thread: { threadRef, render: (inLane: boolean) => <TeamThreadPage key={threadRef} loadDocs={loadDocs} selectDoc={selectDoc} reviewDoc={reviewDoc} loadDecisions={loadDecisions} answerDecision={answerDecision} humanName={humanName} resolveMessageRefs={resolveMessageRefs} openIssue={openIssue} {...(identity.avatarUrl === undefined ? {} : { humanAvatarUrl: identity.avatarUrl })} workspaceId={current.workspaceId} putAttachment={putAttachment} threadRef={threadRef} backToWorkspace={backToWorkspace} selectChannel={selectChannel} selectThread={selectThread} resolveTaskRefs={resolveTaskRefs} resolveThreadRefs={resolveThreadRefs} openMemberSession={openMemberSession} openSidebar={openSidebar} sidebarCollapsed={sidebarCollapsed && !inLane} inLane={inLane} {...(navigationState.channelRef === undefined ? {} : { channelRef: navigationState.channelRef })} {...(navigationState.taskRef === undefined ? {} : { taskRef: navigationState.taskRef })} {...(navigationState.taskNumber === undefined ? {} : { taskNumber: navigationState.taskNumber })} drafts={drafts} getAttachment={getAttachment} readThread={readThread} loadChannels={loadChannels} loadThreadHistory={loadThreadHistory} threadObservations={threadObservations} threadReplyStats={threadReplyStats} threadTurnFailures={threadTurnFailures} loadThreadSessions={loadThreadSessions} updateTask={updateTask} stopSession={stopSession} loadTriggerCatalog={loadTriggerCatalog} subscribeChanges={subscribeChanges} loadMembers={loadMembers} loadMemberActivity={loadMemberActivity} reply={reply} changeTask={changeTask} promoteThread={promoteThread} changeAttention={changeAttention} t={t} /> } })} />
  }
  const welcome = current === undefined
    ? { eyebrow: t('teamMode'), title: t('team'), body: t('empty') }
    : { eyebrow: current.title, title: t('channels'), body: t('selectChannelHint') }
  return <main className={css.welcomeSurface} data-team-conversation>
    <div className={css.welcome}>
      <span className={css.welcomeEyebrow}>{welcome.eyebrow}</span>
      <h1>{welcome.title}</h1>
      <p>{welcome.body}</p>
    </div>
  </main>
}
