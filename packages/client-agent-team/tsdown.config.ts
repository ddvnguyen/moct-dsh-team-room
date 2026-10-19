import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// One pointer for every consumer: scripts/harness-dir.mjs owns the checkout
// (the certification env override, the marker sync-paths wrote, then the daily
// sibling default), so a certification run can never build the client against
// a different checkout than the type and test layer. Both imports stay
// dynamic: a static template-literal module path breaks tsdown's config loader.
const { harnessDir } = await import('../../scripts/harness-dir.mjs')
const presetPath = resolve(harnessDir, 'packages/client/tsdown.client.ts')
const { clientBundle } = await import(pathToFileURL(presetPath).href)

const ID = '@ddvnguyen/moct-dsh-team-room'

// Harness 0.2.0 located a package's manifest by scanning its own workspace for
// the id; 0.2.1 takes the package directory. Both spell the first parameter as
// a string, so the call site stays one line. scripts/build-client.mjs plants
// the workspace manifest the older preset needs.
const legacyLookup = readFileSync(presetPath, 'utf8').includes('workspaceManifest')

// This package lives inside the repository package: the manifest the preset
// must read is the repository root's, two levels above this config.
const packageDir = resolve(import.meta.dirname, '../..')

const bundle = clientBundle(legacyLookup ? ID : packageDir, [
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

// The generated remote lives under `lib/`, outside the tsconfig `include`, so
// tsdown does not apply the facade `paths` to its imports. Resolve the one
// shared runtime it needs explicitly; without this the specifier stays an
// external `require()` the browser module table cannot answer and the whole
// plugin fails to register. Older harness checkouts predate this subpath, so
// the alias only applies when the source is actually there.
const remoteInfoTarget = resolve(harnessDir, 'packages/typert/protocol/src/remote-info.ts')
const teamRemote = {
  name: 'dsh-agent-team-remote-entrypoint',
  resolveId(source: string) {
    if (source === '@ddvnguyen/moct-dsh-team-room/remote') return teamRemoteTarget
    if (source === '@deepseek-ai/dsh-typert-protocol/remote-info') {
      // The generated remote came from a harness that knows this subpath, so a
      // preset checkout that does not is a mismatched pair: the specifier would
      // stay an external `require()` the browser cannot answer and the plugin
      // would fail to register at boot. Fail the build instead of shipping it.
      if (!existsSync(remoteInfoTarget)) {
        throw new Error(
          `client bundle: ${source} is imported by the generated remote but ${remoteInfoTarget} does not exist. ` +
          `Build against the same harness that ran generate:typert (DSH_HARNESS_DIR).`,
        )
      }
      return remoteInfoTarget
    }
    return null
  },
}

export default async (options: Parameters<typeof bundle>[0]) => {
  const configs = await bundle(options)
  return configs.map(entry => ({
    ...entry,
    plugins: [...(entry.plugins ?? []), teamRemote],
  }))
}
