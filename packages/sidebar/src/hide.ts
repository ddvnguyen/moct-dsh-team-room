/** Hiding of the hardcoded "IM Assistant" entry in the codex-ui sidebar.
 *
 *  The entry is rendered by `@michengai/dsh-codex-ui` itself — there is no
 *  plugin slot for it and no configuration switch — so the only lever is the
 *  DOM: the element is marked and hidden in place. No React node is removed
 *  and codex-ui is not patched, so a codex-ui upgrade cannot break the plugin
 *  by removing a hook this code depends on.
 *
 *  The hiding is idempotent: an element that already carries {@link MARKER}
 *  is left alone, so a re-render costs nothing and a second pass never
 *  rewrites a `display` the sidebar owns.
 */

/** Labels of the hardcoded entry: t("sidebar.assistant") in en and zh. */
export const LABELS: readonly string[] = ['IM Assistant', 'IM助理']

/** Attribute that records "this element is hidden by the IM-assistant rule".
 *  It is also how the sidebar layout knows that the `display` write on an
 *  element belongs to this rule and not to the layout itself. */
export const MARKER = 'data-hide-im-assistant'

const CANDIDATES = 'button, [role="menuitem"], [role="option"]'

function isTarget(el: Element): boolean {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria !== undefined && LABELS.includes(aria)) return true
  // Command-palette rows wrap the label in .dcu-search-main next to a detail span.
  const main = el.querySelector('.dcu-search-main')
  const text = (main ?? el).textContent?.trim() ?? ''
  return LABELS.includes(text)
}

/** Hide every matching entry under root; idempotent. Returns how many were newly hidden. */
export function hideImAssistant(root: ParentNode): number {
  let hidden = 0
  for (const el of root.querySelectorAll<HTMLElement>(CANDIDATES)) {
    if (el.hasAttribute(MARKER) || !isTarget(el)) continue
    el.setAttribute(MARKER, '')
    el.style.display = 'none'
    hidden++
  }
  return hidden
}
