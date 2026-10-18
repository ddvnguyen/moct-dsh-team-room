/** Reorganize the Codex-style sidebar: keep only New Tasks, Team Settings, and
 *  Context Insights as top-level entries; move the rest into the Extensions group.
 *  Works against native dsh and dsh-codex-ui by observing the DOM. */
function isTopLevelKeep(label: string): boolean {
  return label === 'New task' || label === 'New Task' || label === '新建任务' ||
    label === 'Team Settings' || label === '团队设置' ||
    label === 'Context Insights' || label === '上下文洞察'
}

function reorganize(root: ParentNode): boolean {
  const nav = root.querySelector('nav.dcu-menu')
  if (!nav) return false
  if (nav.getAttribute('data-dsh-side-menu') === '1') return true
  const ext = nav.querySelector('.dcu-extension-items')
  if (!ext) return false
  for (const child of Array.from(nav.children)) {
    if (child === ext) continue
    if (child instanceof HTMLElement && child.matches('button')) {
      const label = (child.getAttribute('aria-label') ?? child.textContent ?? '').trim()
      if (!isTopLevelKeep(label)) ext.appendChild(child)
    }
  }
  nav.setAttribute('data-dsh-side-menu', '1')
  return true
}

export function apply(ctx: { effect: (fn: () => () => void, label: string) => void }): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const win = document.defaultView
    if (!win) return () => {}
    let done = false
    let frame = 0
    const run = () => {
      frame = 0
      if (done) return
      if (reorganize(document)) {
        done = true
        observer.disconnect()
      }
    }
    const schedule = () => { if (frame === 0 && !done) frame = win.requestAnimationFrame(run) }
    const observer = new win.MutationObserver(schedule)
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true })
      run()
    }
    // Re-arm on navigation so a route change re-runs once.
    const onNav = () => { done = false; if (document.body) { observer.observe(document.body, { childList: true, subtree: true }); run() } }
    win.addEventListener('dsh-native-sidebar-change', onNav)
    return () => {
      observer.disconnect()
      if (frame) win.cancelAnimationFrame(frame)
      win.removeEventListener('dsh-native-sidebar-change', onNav)
    }
  }, 'ddvnguyen-dsh-side-menu: reorganize sidebar')
}
