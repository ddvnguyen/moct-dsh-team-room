/** Sidebar layout for the MOCT workspace.
 *
 *  The codex-ui sidebar renders one `nav.dcu-menu` whose direct children are:
 *  the global-panel buttons (Tasks, Plugin Market, Automation tasks, Team,
 *  Context Insights, Team Settings), the "New task" button, the Extensions
 *  group (`div.dcu-extensions-group`, which owns the toggle and the panel with
 *  Experts/Skills/Plugins/Connectors), then the trailing buttons (Scheduled
 *  tasks, IM Assistant).
 *
 *  The wanted layout is: New task, Teams, Team Settings, Context Insights at the
 *  top level, and every other entry presented as part of Extensions. The group
 *  and its panel are React-owned, so nothing is detached: the entries are
 *  ordered with CSS `order` and indented to line up under the Extensions
 *  chevron, and the ones outside the group follow its `aria-expanded` state.
 *  That keeps React's reconciliation intact and makes collapsing Extensions
 *  hide the same set the panel hides.
 *
 *  Everything is idempotent and re-applied after a re-render; a write happens
 *  only when the computed value differs, so an idle sidebar costs nothing.
 */

/** Entries that stay at the top level, in this order. Both languages, plus the
 *  pre-rename `Team` label so an older MOCT build keeps its seat. */
const KEEP_ORDER = [
  'New task',
  'New Task',
  '新建任务',
  'Teams',
  'Team',
  '团队',
  'Team Settings',
  '团队设置',
  'Context Insights',
  '上下文洞察',
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

export function apply(ctx: {
  effect: (fn: () => () => void, label: string) => void
}): void {
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
