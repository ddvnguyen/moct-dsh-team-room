import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// One pointer for every consumer: scripts/harness-dir.mjs owns the checkout
// (the certification env override, the marker sync-paths wrote, then the daily
// sibling default), so the plugin can never build its browser bundle against
// a different checkout than the type layer. Both imports stay dynamic: a
// static template-literal module path breaks tsdown's config loader.
const { harnessDir } = await import('../../scripts/harness-dir.mjs')
const presetPath = resolve(harnessDir, 'packages/client/tsdown.client.ts')
const { clientBundle } = await import(pathToFileURL(presetPath).href)

const ID = '@ddvnguyen/dsh-sidebar'
const LIB_ENTRY = ['lib/types/index.js']

// Harness 0.2.0 located a package's manifest by scanning its own workspace for
// the id; 0.2.1 takes the package directory. Both spell the first parameter as
// a string, so the call site stays one line and the plugin keeps building
// across the upgrade. scripts/build-client.mjs plants the workspace manifest
// the older preset needs.
const legacyLookup = readFileSync(presetPath, 'utf8').includes('workspaceManifest')

// The preset emits the closure-factory artifact the web loader expects
// (`window.__ModuleLoader__.load({ id, factory })`). A plain ESM output here is
// what produced `SyntaxError: Unexpected token 'export'` at profile boot: the
// browser fetches this file outside any module graph.
export default clientBundle(legacyLookup ? ID : import.meta.dirname, LIB_ENTRY)
