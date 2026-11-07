/** Re-export alias of the mmx-customization client half.
 *
 *  The sidebar moved into `@ddvnguyen/mmx-customization`, which is the only
 *  implementation: this package stays published for one release so an existing
 *  profile that installs `@ddvnguyen/dsh-sidebar` keeps its sidebar without a
 *  profile edit. There is no second copy of the code to drift — the browser
 *  bundle inlines the mmx client entry (`tsdown.config.ts` aliases this
 *  specifier to that source), and the repository's package-boundary gate sees a
 *  declared subpath rather than a relative climb out of this package.
 *
 *  Both rows in one profile would mount the same pass twice, so the mmx client
 *  entry owns one pass per page and the second `apply` is a no-op.
 */

export { MARKER, apply } from '@ddvnguyen/mmx-customization/client'
