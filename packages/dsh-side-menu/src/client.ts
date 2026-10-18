/** Sidebar layout for the MOCT workspace.
 *
 *  Keeps a small set of entries at the top level and presents the rest as the
 *  body of the existing "Extensions" group. It does this with CSS `order` and
 *  indentation instead of moving DOM nodes: `nav.dcu-menu` and its
 *  `.dcu-extension-items` panel are React-owned, so relocating children makes
 *  React's reconciler lose track of them (and the panel is unmounted whenever
 *  Extensions is collapsed, which would take the moved entries with it).
 *
 *  Everything here is idempotent and re-applied after a re-render; the observer
 *  only writes when a value actually differs, so an idle sidebar costs nothing.
 */

/** Entries that stay at the top level, in this order. */
const KEEP_ORDER = [
  'New task',
  'New Task',
  '新建任务',
  'Team',
  '团队',
  'Agents',
  '代理',
  'Team Settings',
  '团队设置',
  'Context Insights',
  '上下文洞察',
]

const EXTENSIONS_LABELS = ['Extensions', '扩展管理']
const INDENT_PX = 28

function labelOf(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
}

function isMenuButton(el: Element): el is HTMLElement {
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

function setHidden(el: HTMLElement, hidden: boolean): void {
  const value = hidden ? 'none' : ''
  if (el.style.display !== value) el.style.display = value
}

/** Returns true when the Extensions group is expanded. Defaults to open when
 *  the toggle has not rendered its state yet, so entries never start hidden. */
function extensionsOpen(toggle: HTMLElement | undefined): boolean {
  if (!toggle) return true
  return toggle.getAttribute('aria-expanded') !== 'false'
}

function reorganize(root: ParentNode): void {
  const nav = root.querySelector('nav.dcu-menu')
  if (!nav) return

  const buttons = Array.from(nav.children).filter(isMenuButton)
  if (buttons.length === 0) return

  const byLabel = new Map<string, HTMLElement>()
  for (const button of buttons) {
    const label = labelOf(button)
    if (!byLabel.has(label)) byLabel.set(label, button)
  }

  const toggle = EXTENSIONS_LABELS.map(label => byLabel.get(label)).find(
    (el): el is HTMLElement => el !== undefined,
  )
  const open = extensionsOpen(toggle)

  // React renders its own Experts/Skills/Plugins/Connectors panel inside
  // Extensions. Those entries stay in the menu here, so the panel is hidden to
  // avoid rendering each of them twice.
  const panel = nav.querySelector<HTMLElement>('.dcu-extension-items')
  if (panel) setHidden(panel, true)

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

  // The Extensions toggle sits immediately above the group it owns.
  if (toggle && !kept.has(toggle)) {
    setOrder(toggle, order++)
    setIndent(toggle, 0)
    setHidden(toggle, false)
  }

  let tail = 100
  for (const button of buttons) {
    if (kept.has(button) || button === toggle) continue
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
