// @vitest-environment node
//
// The two patch appliers parse-check their output BEFORE writing it (the
// deploy runs them on every install). The check used to scratch in
// `tmpdir()`, which on the lane host is a small shared `/tmp` tmpfs: when it
// was full, `writeFileSync` threw ENOSPC, the applier misreported it as "the
// patched bundle does not parse", and the lane deploy died (M-66). The rule
// (same as moct#30's build-info write): scratch BESIDE the file being
// written, never in `tmpdir()`.
//
// These cases prove the rule by running each applier with `TMPDIR` pointed at
// a NON-WRITABLE directory: `--check` must still pass and the run must leave
// no scratch behind. (Caveat, kept honest: mode 555 is ignored for uid 0;
// the repo's CI and dev hosts run as a normal user.)
//
// The fixtures are built from the REAL edit lists at test time — an anchor
// that moves breaks the applier's own `--check` against the real bundle; it
// must not silently pass here against a stale checked-in copy. Each edit's
// `from` is placed in the minimal surrounding context its `to` needs to
// parse (some edits end mid-expression, as they do inside the real bundle);
// a changed edit shape fails this fixture loudly.
//
// The sidebar applier carries one edit set per bundle SHAPE (M-276: rc.1
// replaced the 1.x tab strip with the 2.x sidebar nav), so each set is built
// and checked on its own: a set whose anchors belong to the other shape can
// never match, and a shared fixture would hide that.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error the edit list is plain ESM without a declaration file
import { EDIT_SETS as SIDEBAR_EDIT_SETS, PATCH_MARKER as SIDEBAR_MARKER, applySidebarPatch as applySidebar } from '../../../scripts/codex-ui-sidebar-patch/edits.mjs'
// @ts-expect-error the market edit list is plain ESM without a declaration file
import { EDITS as MARKET_EDITS, ACCESSOR_MARKER as MARKET_ACCESSOR, PATCH_MARKER as MARKET_MARKER } from '../../../scripts/dsh-market-trusted-host-patch/edits.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SIDEBAR_APPLIER = join(REPO_ROOT, 'scripts', 'codex-ui-sidebar-patch', 'apply.mjs')
const MARKET_APPLIER = join(REPO_ROOT, 'scripts', 'dsh-market-trusted-host-patch', 'apply.mjs')
/** rc.1's bundle shape, verbatim, for the shape the lane deploy actually meets. */
const RC1_FIXTURE = join(REPO_ROOT, 'scripts', 'codex-ui-sidebar-patch', 'fixtures', 'codex-ui-2.0.19-layout.js')

/** The surrounding context one sidebar edit needs for its `to` to parse. */
const SIDEBAR_CONTEXT: Record<string, [open: string, close: string]> = {
  'registry-helpers': ['', ''],
  'sidebar-native-tabs-state': ['', ''],
  // `}, [` closes the effect callback and opens its dependency array — the
  // array's items and the closing `]);` come from the lines after the anchor.
  'sidebar-native-tab-reset': ['function __FIXTURE__() {\nuseEffect(() => {\n', '\n\t\t\t\tshowChannels,\n\t\t\t\tt\n\t\t\t]);\n}\n'],
  // A bare `children:` property of a button object.
  'sidebar-tab-label-icons': ['function __FIXTURE__() {\nreturn {\n', '\n};\n}\n'],
  'sidebar-tab-label-icons-channels': ['function __FIXTURE__() {\nreturn {\n', '\n};\n}\n'],
  'sidebar-tab-label-icons-schedule': ['function __FIXTURE__() {\nreturn {\n', '\n};\n}\n'],
  // `return [...] … }, [deps]);` closes the memo callback and the call.
  'sidebar-native-tab-items': ['function __FIXTURE__() {\nuseMemo(() => {\n', '\n}\n'],
  // Starts mid-argument (`}),` closes the sibling element left open by the
  // wrapper), and its tail sits INSIDE a ternary whose else-branch comes
  // after the anchor — the closer finishes the opened `"div", {` object and
  // supplies the missing `: else` before the children array closes.
  'sidebar-native-tab-body': [
    'function __FIXTURE__() {\nreturn (0, react_jsx_runtime.jsx)("div", {\nchildren: [\n(0, react_jsx_runtime.jsx)("span", {\n',
    '\nchildren: null\n}) : null\n],\n});\n}\n',
  ],
  'sidebar-top-panels-state': ['', ''],
  // Starts mid-object (the `}),` closes the "New task" element) and ends
  // with the open `jsxs("div", { className: "dcu-extensions-group",`.
  'sidebar-top-panels-render': [
    'function __FIXTURE__() {\nreturn (0, react_jsx_runtime.jsxs)("div", {\nchildren: [\n(0, react_jsx_runtime.jsx)("div", {\n',
    '\nchildren: null\n})\n]\n});\n}\n',
  ],
  // Opens the map callback and the button object; both close after the anchor.
  'sidebar-nested-panels-render': ['function __FIXTURE__() {\n', '\nchildren: null\n})\n);\n}\n'],
  'plugin-native-tab-registry': ['', ''],
  // The 2.x sidebar nav: helpers land at module scope beside the layout model.
  'sidebar-nav-top-panels-helpers': ['', ''],
  // Opens the effect and the `setLayout` callback the anchor sits inside;
  // `setLayout`, `react` and `availableIds` are free variables in the real
  // component, so the fixture declares them. The closer finishes the layout
  // comparison the anchor stops at, then both frames.
  'sidebar-nav-top-panels-state': [
    'function __FIXTURE__() {\nconst [layout, setLayout] = [void 0, () => {}];\nconst availableIds = [];\nconst react = { useRef: (value) => ({ current: value }), useEffect: () => {}, useSyncExternalStore: () => new Set() };\n',
    '\n\t\t\t\t\tif (next.pinned.length === prev.pinned.length && next.more.length === prev.more.length) return prev;\n\t\t\t\t\treturn next;\n\t\t\t\t});\n\t\t\t}, [topPanelIds]);\n}\n',
  ],
  // The anchor is the tail of that effect: it closes the `setLayout` callback
  // and the effect call, so the fixture only has to open both frames.
  'sidebar-nav-top-panels-deps': ['function __FIXTURE__() {\nuseEffect(() => {\nsetLayout((prev) => {\n', '\n}\n'],
}

/**
 * The surrounding context one market edit needs for its `to` to parse.
 *
 * The dshmarket restart.js anchors end where the published file's own text
 * takes over: the served-authority edit starts inside the exported function's
 * body (its `return` needs a function scope) and ends INSIDE an open block
 * comment, as it does upstream — MARKET_TAIL after the last edit closes it.
 */
const MARKET_CONTEXT: Record<string, [open: string, close: string]> = {
  'http-declared-trusted-hosts': ['', ''],
  'restart-import-declared-hosts': ['', ''],
  'restart-served-authority': ['function __FIXTURE__() {\n', ''],
  'restart-reachable-from': ['', ''],
  'restart-self-uninstall-reachable-from': ['', ''],
  'restart-trusted-restart-request': ['', ''],
  'restart-trusted-download-request': ['', ''],
}

/** A throwaway workspace under the repo's own node_modules cache, never tmpdir(). */
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const nonWritable = join(root, 'tmp')
    if (existsSync(nonWritable)) chmodSync(nonWritable, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

const scratchCache = join(REPO_ROOT, 'node_modules', '.cache')

function write(root: string, relative: string, content: string) {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function run(applier: string, args: string[], tmp: string) {
  const result = spawnSync(process.execPath, [applier, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmp },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function libEntries(lib: string) {
  return readdirSync(lib).sort()
}

describe('the codex-ui applier picks the edit set the bundle shape needs', () => {
  it('applies the 2.x sidebar-nav set to the rc.1 bundle shape', () => {
    mkdirSync(scratchCache, { recursive: true })
    const root = mkdtempSync(join(scratchCache, 'm276-rc1-fixture-'))
    roots.push(root)
    const source = readFileSync(RC1_FIXTURE, 'utf8')
    const lib = join(root, 'lib')
    write(root, 'lib/client.js', source)

    const check = run(SIDEBAR_APPLIER, [root, '--check'], lib)
    expect(check.status).toBe(0)
    expect(check.output).toContain('via "sidebar-nav"')

    const applied = run(SIDEBAR_APPLIER, [root], lib)
    expect(applied.status).toBe(0)
    const patched = readFileSync(join(lib, 'client.js'), 'utf8')
    // The rc.1 bundle's own shape stays in place: the policy is read, the nav
    // normalizes through it, and the layout effect re-runs when it publishes.
    expect(patched).toContain('function normalizeTopPanels(saved, availableIds, topPanelIds) {')
    expect(patched).toContain('const topPanelIds = (0, react.useSyncExternalStore)(subscribeTopPanels, readTopPanelIds, readTopPanelIds);')
    expect(patched).toContain('const next = normalizeTopPanels(prev, availableIds, topPanelIds);')
    expect(patched).toContain('\t\t\t\tavailableIds,\n\t\t\t\ttopPanelIds\n\t\t\t]);')
  })

  it('fails loudly, naming the closest set, on a bundle neither shape matches', () => {
    mkdirSync(scratchCache, { recursive: true })
    const root = mkdtempSync(join(scratchCache, 'm276-unknown-shape-'))
    roots.push(root)
    write(root, 'lib/client.js', 'const unrelated = 1;\n')

    const check = run(SIDEBAR_APPLIER, [root, '--check'], join(root, 'lib'))
    expect(check.status).toBe(3)
    expect(check.output).toContain('no edit set matches this bundle')
    // The closest set is the one that has an anchor in this bundle at all;
    // naming it is what turns a lane failure into a one-line fix.
    expect(check.output).toContain('Closest is "sidebar-nav"')
    expect(check.output).toContain('anchor for edit "sidebar-nav-top-panels-helpers" is missing')
    // Nothing was written: an unmatched bundle is left exactly as it was.
    expect(readFileSync(join(root, 'lib', 'client.js'), 'utf8')).toBe('const unrelated = 1;\n')
    expect(libEntries(join(root, 'lib'))).toEqual(['client.js'])
  })

  it('lifts the panels the deployment policy names into the pinned zone, and only those', async () => {
    mkdirSync(scratchCache, { recursive: true })
    const root = mkdtempSync(join(scratchCache, 'm276-top-panels-'))
    roots.push(root)
    // The patched fixture exports the seam so it can be exercised directly.
    const patched = applySidebar(readFileSync(RC1_FIXTURE, 'utf8')).source
    const file = join(root, 'bundle.mjs')
    writeFileSync(file, `${patched}\nexport { normalizeTopPanels, readTopPanelIds };\n`)
    const seam = await import(pathToFileURL(file).href)
    const available = ['plugins', 'team', 'context', 'other']

    // No store published: upstream's own layout, untouched.
    expect(await seam.normalizeTopPanels(undefined, available, new Set())).toEqual({ pinned: [], more: ['team', 'context', 'other'] })

    // The store names two panels: they sit at the top level, in saved order,
    // and the rest keeps upstream's order.
    expect(await seam.normalizeTopPanels(undefined, available, new Set(['context', 'team']))).toEqual({ pinned: ['team', 'context'], more: ['other'] })

    // A saved layout the user arranged is respected except for the policy,
    // which is a deployment decision: `team` moves up, `other` keeps its place.
    const saved = { pinned: ['other'], more: ['team', 'context'] }
    expect(await seam.normalizeTopPanels(saved, available, new Set(['team']))).toEqual({ pinned: ['team', 'other'], more: ['context'] })

    // One Set identity per published array, so the nav's snapshot is stable.
    const ids = ['context']
    ;(globalThis as { __dshTopPanels?: unknown }).__dshTopPanels = { ids }
    expect(seam.readTopPanelIds()).toBe(seam.readTopPanelIds())
    expect([...seam.readTopPanelIds()]).toEqual(['context'])
    delete (globalThis as { __dshTopPanels?: unknown }).__dshTopPanels
  })
})

describe('patch appliers scratch beside their target, never in tmpdir()', () => {
  it('codex-ui: --check and the write pass with a non-writable TMPDIR and leave no scratch', () => {
    mkdirSync(scratchCache, { recursive: true })
    const root = mkdtempSync(join(scratchCache, 'm66-patch-appliers-'))
    roots.push(root)
    // The TMPDIR the appliers must NOT need: unwritable for a normal user.
    const nonWritable = join(root, 'tmp')
    mkdirSync(nonWritable)
    chmodSync(nonWritable, 0o555)
    // The fixture is one edit set: every `from` anchor once, each in the
    // context its replacement needs to parse.
    for (const set of SIDEBAR_EDIT_SETS as { id: string; edits: { id: string; from: string }[] }[]) {
      const setRoot = join(root, set.id)
      const source = set.edits
        .map((edit) => {
          const [open, close] = SIDEBAR_CONTEXT[edit.id] ?? ['', '']
          const name = `fixture_${edit.id.replaceAll('-', '_')}`
          return `${open.replaceAll('__FIXTURE__', name)}${edit.from}${close}`
        })
        .join('\n')
      const lib = join(setRoot, 'lib')
      write(setRoot, 'lib/client.js', source)

      const check = run(SIDEBAR_APPLIER, [setRoot, '--check'], nonWritable)
      expect(check.status).toBe(0)
      expect(check.output).toContain(`via "${set.id}" (${String(set.edits.length)} edits)`)
      expect(readFileSync(join(lib, 'client.js'), 'utf8')).toBe(source)
      expect(libEntries(lib)).toEqual(['client.js'])

      const applied = run(SIDEBAR_APPLIER, [setRoot], nonWritable)
      expect(applied.status).toBe(0)
      expect(readFileSync(join(lib, 'client.js'), 'utf8')).toContain(SIDEBAR_MARKER)
      // The parse-check scratch is gone; only the bundle and its backup remain.
      expect(libEntries(lib).filter((entry) => entry.startsWith('.patch-check-'))).toEqual([])
      expect(libEntries(lib)).toEqual(['client.js', 'client.js.orig'])
    }
  })

  it('dshmarket: --check and the write pass with a non-writable TMPDIR and leave no scratch', () => {
    mkdirSync(scratchCache, { recursive: true })
    const root = mkdtempSync(join(scratchCache, 'm66-patch-appliers-'))
    roots.push(root)
    const nonWritable = join(root, 'tmp')
    mkdirSync(nonWritable)
    chmodSync(nonWritable, 0o555)
    write(root, 'package.json', `${JSON.stringify({ name: 'dshmarket', version: '0.0.0-fixture' }, null, 2)}\n`)
    for (const [file, edits] of Object.entries(MARKET_EDITS as Record<string, { id: string; from: string }[]>)) {
      const source = edits
        .map((edit) => {
          const [open, close] = MARKET_CONTEXT[edit.id] ?? ['', '']
          const name = `fixture_${edit.id.replaceAll('-', '_')}`
          return `${open.replaceAll('__FIXTURE__', name)}${edit.from}${close}`
        })
        .join('\n')
      // restart.js's last anchor leaves the served-authority comment open.
      const tail = file === 'lib/restart.js' ? '\n */\n' : ''
      write(root, file, `${source}${tail}`)
    }
    const lib = join(root, 'lib')

    const check = run(MARKET_APPLIER, [root, '--check'], nonWritable)
    expect(check.status).toBe(0)
    expect(check.output).toContain('patch applies cleanly to dshmarket 0.0.0-fixture (lib/http.js, lib/restart.js)')
    expect(libEntries(lib)).toEqual(['http.js', 'restart.js'])

    const applied = run(MARKET_APPLIER, [root], nonWritable)
    expect(applied.status).toBe(0)
    const expectedEdits = Object.values(MARKET_EDITS as Record<string, unknown[]>)
      .reduce((sum, edits) => sum + edits.length, 0)
    expect(applied.output).toContain(`(${String(expectedEdits)} edits)`)
    expect(readFileSync(join(lib, 'http.js'), 'utf8')).toContain(MARKET_ACCESSOR)
    expect(readFileSync(join(lib, 'restart.js'), 'utf8')).toContain(MARKET_MARKER)
    expect(libEntries(lib).filter((entry) => entry.startsWith('.patch-check-'))).toEqual([])
    expect(libEntries(lib)).toEqual(['http.js', 'http.js.orig', 'restart.js', 'restart.js.orig'])
  })
})
