/** Sidebar layout for the MOCT workspace.
 *
 *  The codex-ui sidebar renders one `nav.dcu-menu`. Since codex-ui 1.1.39 the
 *  plugin panels (Tasks, Plugin Market, Automation tasks, Team, Context
 *  Insights, Team Settings) are children of the Extensions group, which owns
 *  the toggle and the panel with Experts/Skills/Plugins/Connectors; the
 *  "New task" button and the group itself are the menu's direct children.
 *
 *  The wanted layout is: New task, Context Insights, Team Settings at the top
 *  level, and every other entry presented as part of Extensions. Two pieces
 *  do that:
 *
 *  - The patched codex-ui renders the panels this plugin lists in
 *    {@link TOP_PANEL_IDS} next to "New task" instead of inside Extensions.
 *    The patch owns the mechanism; this plugin owns the policy.
 *  - The order is set with CSS `order` on the menu's children. The group and
 *    its panel are React-owned, so nothing is detached: the entries outside
 *    the group are ordered in place and indented to line up under the
 *    Extensions chevron, and the ones outside the group follow its
 *    `aria-expanded` state. That keeps React's reconciliation intact and
 *    makes collapsing Extensions hide the same set the panel hides.
 *
 *  Everything is idempotent and re-applied after a re-render; a write happens
 *  only when the computed value differs, so an idle sidebar costs nothing.
 */

/** The panels that belong next to "New task" rather than inside Extensions.
 *  The ids are the ones the owning plugins register with
 *  `sidebar.panellist`: dsh-context owns Context Insights, the Team Room owns
 *  Team Settings. */
const TOP_PANEL_IDS = ['dsh-context', 'agent-team-settings']

/** The key the patched codex-ui reads the top-level panel list from. */
const TOP_PANELS_KEY = '__dshTopPanels'

/** Entries that stay at the top level, in this order. Both languages. */
const KEEP_ORDER = [
  'New task',
  'New Task',
  '新建任务',
  'Context Insights',
  '上下文洞察',
  'Team Settings',
  '团队设置',
]

const INDENT_PX = 28

function labelOf(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
}

function isButton(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.matches('button')
}

function setOrder(el: HTMLElement, order: number): void {
  const value = String(order)
  if (el.style.order !== value) el.style.order = value
}

function setIndent(el: HTMLElement, indent: number): void {
  const value = indent === 0 ? '' : `${indent}px`
  if (el.style.marginLeft !== value) el.style.marginLeft = value
}

/** Elements this plugin hid. Other plugins own their own `display` writes —
 *  @ddvnguyen/dsh-hide-im-assistant sets `none` on IM Assistant — so clearing
 *  only what we set keeps collapsing Extensions from undoing them. */
const hiddenByPlugin = new WeakSet<HTMLElement>()

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (hidden) {
    if (el.style.display === 'none') return
    el.style.display = 'none'
    hiddenByPlugin.add(el)
    return
  }
  if (!hiddenByPlugin.has(el)) return
  el.style.display = ''
  hiddenByPlugin.delete(el)
}

/** True while the Extensions panel is expanded. A toggle that has not rendered
 *  its state yet counts as open, so entries never start hidden. */
function extensionsOpen(toggle: HTMLElement | null): boolean {
  if (!toggle) return true
  return toggle.getAttribute('aria-expanded') !== 'false'
}

function reorganize(root: ParentNode): void {
  const nav = root.querySelector('nav.dcu-menu')
  if (!nav) return

  const children = Array.from(nav.children)
  const buttons = children.filter(isButton)
  if (buttons.length === 0) return

  const byLabel = new Map<string, HTMLElement>()
  for (const button of buttons) {
    const label = labelOf(button)
    if (!byLabel.has(label)) byLabel.set(label, button)
  }

  const group = children.find(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.classList.contains('dcu-extensions-group'),
  )
  const toggle = group?.querySelector<HTMLElement>('.dcu-extensions-toggle') ?? null
  const open = extensionsOpen(toggle)

  // Keep the requested entries first, in the requested order. The Extensions
  // group follows them; every other direct child becomes one of its entries.
  let order = 0
  const kept = new Set<HTMLElement>()
  for (const name of KEEP_ORDER) {
    const el = byLabel.get(name)
    if (!el || kept.has(el)) continue
    kept.add(el)
    setOrder(el, order++)
    setIndent(el, 0)
    setHidden(el, false)
  }

  if (group) {
    setOrder(group, order++)
    setIndent(group, 0)
    setHidden(group, false)
  }

  let tail = 100
  for (const button of buttons) {
    if (kept.has(button)) continue
    setOrder(button, tail++)
    setIndent(button, INDENT_PX)
    setHidden(button, !open)
  }
}

/** The store the patched codex-ui reads the top-level panel list from. The
 *  shape is a contract between this plugin and the patch: `ids` is the current
 *  set of panel ids, `subscribe` lets the host re-render when it changes. */
interface TopPanelStore {
  ids: Set<string>
  subscribe: (listener: () => void) => () => void
  set: (ids: readonly string[]) => void
}

/**
 * Publish the top-level panel list for the patched codex-ui.
 *
 * Without the patch the host keeps every plugin panel inside Extensions, so
 * this call has no effect and the layout stays the host's. With the patch the
 * panels in {@link TOP_PANEL_IDS} are rendered next to "New task".
 */
function publishTopPanels(ids: readonly string[]): void {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[TOP_PANELS_KEY] as TopPanelStore | undefined
  if (existing !== undefined && typeof existing.set === 'function') {
    existing.set(ids)
    return
  }
  const listeners = new Set<() => void>()
  const store: TopPanelStore = {
    ids: new Set(ids),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      const changed = next.length !== store.ids.size || next.some(id => !store.ids.has(id))
      if (!changed) return
      store.ids = new Set(next)
      for (const listener of listeners) listener()
    },
  }
  scope[TOP_PANELS_KEY] = store
}

export function apply(ctx: {
  effect: (fn: () => () => void, label: string) => void
}): void {
  publishTopPanels(TOP_PANEL_IDS)

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const win = document.defaultView
    if (!win || !document.body) return () => {}

    let frame = 0
    const run = (): void => {
      frame = 0
      reorganize(document)
    }
    const schedule = (): void => {
      if (frame === 0) frame = win.requestAnimationFrame(run)
    }

    // `attributes` is narrowed to aria-expanded so unrelated attribute churn
    // does not wake the observer.
    const observer = new win.MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    })

    // Re-apply on client-side navigation, where the sidebar may be remounted
    // without a mutation the observer attributes to the target subtree.
    win.addEventListener('dsh-native-sidebar-change', schedule)
    run()

    return () => {
      observer.disconnect()
      if (frame) win.cancelAnimationFrame(frame)
      win.removeEventListener('dsh-native-sidebar-change', schedule)
    }
  }, 'ddvnguyen-dsh-side-menu: organize sidebar')
}
