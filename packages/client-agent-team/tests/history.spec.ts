// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { TeamHistory } from '../src/client/history.ts'
import { TeamNavigation } from '../src/client/navigation.ts'

/**
 * The browser's history traversal is asynchronous: the `popstate` that
 * restores the position arrives after the traversal, so a test waits for the
 * event rather than for a clock.
 */
function traversed(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  window.addEventListener('popstate', () => { resolve() }, { once: true })
  return promise
}

function seat(): { navigation: TeamNavigation, history: TeamHistory } {
  const navigation = new TeamNavigation()
  const history = new TeamHistory(navigation)
  return { navigation, history }
}

describe('TeamHistory', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('pushes one entry for the issue and consumes it when the issue closes', async () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()

    const opened = history.length
    navigation.actions().openIssue('task:1' as never, 'slice')
    expect(history.length).toBe(opened + 1)
    expect(navigation.getSnapshot().issueRef).toBe('task:1')

    const popped = traversed()
    navigation.actions().closeIssue()
    await popped

    expect(history.length).toBe(opened)
    expect(navigation.getSnapshot().issueRef).toBeUndefined()
    expect(navigation.getSnapshot().board).toBe(true)
  })

  it('closes the slice when the browser goes back over the issue entry', async () => {
    const { navigation } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'slice')
    expect(navigation.getSnapshot().issueRef).toBe('task:1')

    const popped = traversed()
    window.history.back()
    await popped

    // The browser's back consumed the entry the open pushed, and the face the
    // issue was opened over is the place the reader lands on.
    expect(navigation.getSnapshot().issueRef).toBeUndefined()
    expect(navigation.getSnapshot().board).toBe(true)
  })

  it('keeps the issue slot with its variant when the variant changes', async () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'slice')
    const entries = history.length

    navigation.actions().setIssueVariant('page')

    // The same place, presented differently: the entry is rewritten, not
    // stacked, and the variant travels with the slot.
    expect(history.length).toBe(entries)
    expect(navigation.getSnapshot().issueVariant).toBe('page')

    const popped = traversed()
    window.history.back()
    await popped
    expect(navigation.getSnapshot().issueRef).toBeUndefined()
  })

  it('creates no entry for a change that is not a place', () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    const entries = history.length

    // A Member Session is a runtime overlay over the seat, not a place in it.
    navigation.actions().enterMemberSession('session:1' as never)
    navigation.actions().exitMemberSession()

    expect(history.length).toBe(entries)
  })

  it('never changes the path', () => {
    const { navigation } = seat()
    const path = window.location.pathname

    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'page')
    navigation.actions().setIssueVariant('slice')

    expect(window.location.pathname).toBe(path)
  })

  it('bounds the stack and drops the oldest entry', () => {
    const { navigation, history } = seat()
    for (let index = 0; index < 40; index += 1) {
      navigation.actions().selectChannel(`channel:${index}` as never)
    }

    expect(history.length).toBe(32)
  })

  it('restores the page after a reload and leaves the slice absent', () => {
    const first = seat()
    first.navigation.actions().selectBoard()
    first.navigation.actions().openIssue('task:1' as never, 'page')

    // A reload: a new navigation over the same storage and the same browser
    // entry state.
    const reloaded = seat()
    expect(reloaded.navigation.getSnapshot().issueRef).toBe('task:1')
    expect(reloaded.navigation.getSnapshot().issueVariant).toBe('page')
    expect(reloaded.history.length).toBeGreaterThan(1)

    // The slice is an overlay over a live face: it is not persisted, and the
    // URL's `variant` is dropped on a cold load. The issue the link names is
    // still a position, so the reload lands on its **page** — never on a
    // dialog nobody opened. The face behind it is the one the reader left.
    first.navigation.actions().setIssueVariant('slice')
    const afterSlice = seat()
    expect(afterSlice.navigation.getSnapshot().issueRef).toBe('task:1')
    expect(afterSlice.navigation.getSnapshot().issueVariant).toBe('page')
    expect(afterSlice.navigation.getSnapshot().board).toBe(true)
  })

  it('does not push when a position is restored', async () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'slice')
    const entries = history.length

    const popped = traversed()
    window.history.back()
    await popped

    expect(history.length).toBe(entries)
  })

  it('carries the persisted mode in the position without making an entry', async () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    navigation.actions().enterTeam()
    const entries = history.length

    // The conversation↔Team toggle is a change of seat, not of place.
    expect(history.length).toBe(entries)

    navigation.actions().leaveTeam()
    expect(history.length).toBe(entries)

    navigation.actions().enterTeam()
    const popped = traversed()
    window.history.back()
    await popped
    expect(navigation.getSnapshot().mode).toBe('conversation')
  })

  it('walks the four positions of the card journey', async () => {
    const { navigation } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'page')
    navigation.actions().selectThread('thread:1' as never, 'channel:1' as never)

    let popped = traversed()
    window.history.back()
    await popped
    expect(navigation.getSnapshot().issueRef).toBe('task:1')

    popped = traversed()
    window.history.back()
    await popped
    expect(navigation.getSnapshot().board).toBe(true)
    expect(navigation.getSnapshot().issueRef).toBeUndefined()

    popped = traversed()
    window.history.forward()
    await popped
    expect(navigation.getSnapshot().issueRef).toBe('task:1')

    popped = traversed()
    window.history.forward()
    await popped
    expect(navigation.getSnapshot().threadRef).toBe('thread:1')
  })

  it('goes back through the in-app control and the browser button alike', async () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    navigation.actions().selectChannel('channel:1' as never)

    let popped = traversed()
    expect(history.back()).toBe(true)
    await popped
    expect(navigation.getSnapshot().channelRef).toBeUndefined()

    popped = traversed()
    expect(history.forward()).toBe(true)
    await popped
    expect(navigation.getSnapshot().channelRef).toBe('channel:1')
  })

  it('reports that there is nowhere to go when the stack is at its base', () => {
    const { history } = seat()
    expect(history.canGoBack).toBe(false)
    expect(history.canGoForward).toBe(false)
    expect(history.back()).toBe(false)
    expect(history.forward()).toBe(false)
  })

  it('leaves the browser history alone for a change that is not a place', () => {
    const { navigation } = seat()
    const entries = window.history.length

    navigation.actions().enterMemberSession('session:1' as never)

    expect(window.history.length).toBe(entries)
  })

  it('creates no entry once the seat has disposed of it', () => {
    const { navigation, history } = seat()
    const entries = history.length

    history.dispose()
    navigation.actions().selectBoard()

    expect(history.length).toBe(entries)
  })

  it('carries the issue and its variant in the URL query', async () => {
    // A parameter the plugin does not own is the URL's, not the Team's.
    window.history.replaceState(null, '', '/?theme=dark')
    const { navigation } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'slice')

    const query = new URLSearchParams(window.location.search)
    expect(query.get('issue')).toBe('task:1')
    expect(query.get('variant')).toBe('slice')
    expect(query.get('theme')).toBe('dark')

    // The variant travels with the slot: the same place, presented
    // differently, and the query follows it.
    navigation.actions().setIssueVariant('page')
    expect(new URLSearchParams(window.location.search).get('variant')).toBe('page')

    // The position has no issue any more, so the query names none: the link
    // must not name an issue the reader is not on.
    const popped = traversed()
    navigation.actions().closeIssue()
    await popped
    expect(new URLSearchParams(window.location.search).get('issue')).toBeNull()
  })

  it('never changes the path while the query follows the position', () => {
    const { navigation } = seat()
    const path = window.location.pathname

    navigation.actions().selectBoard()
    expect(window.location.pathname).toBe(path)
    expect(new URLSearchParams(window.location.search).get('issue')).toBeNull()

    navigation.actions().openIssue('task:1' as never, 'page')
    expect(window.location.pathname).toBe(path)
    expect(new URLSearchParams(window.location.search).get('issue')).toBe('task:1')
  })

  it('opens the issue a shared link names on a cold load', () => {
    // The shared link: the URL names the issue, and the stored snapshot does
    // not — so the query is what opens it.
    window.history.replaceState(null, '', '/?issue=task%3A9')
    const { navigation, history } = seat()

    expect(navigation.getSnapshot().issueRef).toBe('task:9')
    // A slice is transient and a cold start has no opener to return the
    // focus to, so the boot opens the page.
    expect(navigation.getSnapshot().issueVariant).toBe('page')
    // The boot is not a navigation: the stack seeds with the issue open.
    expect(history.length).toBe(1)
  })

  it('drops the slice a shared link names and opens the page', () => {
    window.history.replaceState(null, '', '/?issue=task%3A9&variant=slice')
    const { navigation } = seat()

    expect(navigation.getSnapshot().issueRef).toBe('task:9')
    expect(navigation.getSnapshot().issueVariant).toBe('page')
  })

  it('leaves the query and the path alone for a change that is not a place', () => {
    const { navigation, history } = seat()
    navigation.actions().selectBoard()
    navigation.actions().openIssue('task:1' as never, 'page')
    const entries = history.length
    const query = window.location.search
    const path = window.location.pathname

    // A picker, a disclosure, a filter and an inline edit are not places:
    // they reach neither the stack nor the URL.
    navigation.actions().enterMemberSession('session:1' as never)
    navigation.actions().exitMemberSession()

    expect(history.length).toBe(entries)
    expect(window.location.search).toBe(query)
    expect(window.location.pathname).toBe(path)
  })
})
