import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// One pointer for every consumer: scripts/harness-dir.mjs owns the checkout
// (the certification env override, the marker sync-paths wrote, then the daily
// sibling default), so a certification run can never build the client against
// a different checkout than the type and test layer. Both imports stay
// dynamic: a static template-literal module path breaks tsdown's config loader.
const { harnessDir } = await import('../../scripts/harness-dir.mjs')
const { clientBundle } = await import(pathToFileURL(resolve(harnessDir, 'packages/client/tsdown.client.ts')).href)

const bundle = clientBundle(resolve(import.meta.dirname, '../..'), [
  'lib/types/index.js',
])

// The Team Remote resolves through its own plugin rather than `resolve.alias`.
// tsdown reads the client's tsconfig `paths`, whose `/remote` entry points at
// the generated `.d.ts` for the type facets, and that mapping is what resolves
// this specifier; the generated runtime artifact is the one the package's own
// `./remote` export declares as `default`. The plugin therefore pins the
// specifier explicitly instead of leaving it to a mapping that targets types.
//
// The target is anchored to this config file, never to the process cwd. The
// earlier `resolve('../../../packages/...')` form was relative to whatever
// directory the config ran from — tsdown runs from `packages/client-agent-team`,
// one level deeper than the repository root the string was written for, so it
// silently pointed outside the repository.
const teamRemoteTarget = resolve(import.meta.dirname, '../agent-team/lib/typert.remote-client.js')
// Runtime subpaths: the typecheck facades map this package's subpaths to its
// declaration twins (src/x.ts → lib/types/x.d.ts) — right for tsc, wrong for
// bundling, because alpha.5 moved the typert construction onto subpaths whose
// source IS runtime: '@deepseek-ai/dsh-typert-protocol/remote-info' lazily
// assembles the generated Remote with caller-supplied Zod, and its
// declaration file is declaration-only (`export declare function` carries no
// runtime export). The generated remote clients import these subpaths for
// value, so the client bundle resolves them to their Harness source instead.
// The mapping is classified from the manifest's exports map — every subpath
// exported under a "default" (runtime) condition whose source twin exists is
// pinned to that twin — so the next runtime subpath the package adds lands
// the same way without a name list. tsc keeps the declaration twins: all three
// packages typecheck against the same facade, preserving type identity.
const typertManifest = JSON.parse(
  readFileSync(resolve(harnessDir, 'packages/typert/protocol/package.json'), 'utf8'),
)
const runtimeSubpathSources: Record<string, string> = {}
for (const [key, entry] of Object.entries(typertManifest.exports ?? {})) {
  if (!key.startsWith('./') || key.endsWith('*')) continue
  const runtime = typeof entry === 'string' ? entry : entry.default
  if (typeof runtime !== 'string' || !/\.js$/.test(runtime)) continue
  const source = runtime.replace(/^\.\//, '').replace(/^lib\/(?:types\/)?/, 'src/').replace(/\.js$/, '.ts')
  if (!existsSync(resolve(harnessDir, 'packages/typert/protocol', source))) continue
  runtimeSubpathSources['@deepseek-ai/dsh-typert-protocol' + key.slice(1)] =
    resolve(harnessDir, 'packages/typert/protocol', source)
}
const teamRemote = {
  name: 'dsh-agent-team-remote-entrypoint',
  resolveId(source: string) {
    if (source === '@ddvnguyen/moct-dsh-team-room/remote') return teamRemoteTarget
    return runtimeSubpathSources[source] ?? null
  },
}

export default async (options: Parameters<typeof bundle>[0]) => {
  const configs = await bundle(options)
  return configs.map(entry => ({
    ...entry,
    plugins: [...(entry.plugins ?? []), teamRemote],
  }))
}
