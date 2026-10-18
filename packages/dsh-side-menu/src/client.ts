/** Reorganize the Codex-style sidebar: keep only New Tasks, Team Settings, and
 *  Context Insights as top-level entries; move the rest into the Extensions group.
 *  Works against native dsh and dsh-codex-ui by observing the DOM. */
function isTopLevelKeep(el: Element): boolean {
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
  return label === 'New task' || label === 'New Task' || label === '新建任务' ||
    label === 'Team Settings' || label === '团队设置' ||
    label === 'Context Insights' || label === '上下文洞察'
}

function reorganize(root: ParentNode): void {
  const nav = root.querySelector('nav.dcu-menu, nav[aria-label]')
  if (!nav) return
  // Idempotent: mark processed.
  if (nav.getAttribute('data-dsh-side-menu') === '1') return
  nav.setAttribute('data-dsh-side-menu', '1')
  // Move non-kept direct entries into the extensions group if present.
  const ext = nav.querySelector('.dcu-extension-items')
  if (!ext) return
  for (const child of Array.from(nav.children)) {
    if (child === ext) continue
    if (child.matches('button') && !isTopLevelKeep(child)) {
      ext.appendChild(child)
    }
  }
}

export function apply(ctx: { effect: (fn: () => () => void, label: string) => void }): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    let frame = 0
    const run = () => { frame = 0; reorganize(document) }
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(run) }
    const observer = new MutationObserver(schedule)
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
      run()
    }
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, 'ddvnguyen-dsh-side-menu: reorganize sidebar')
}
