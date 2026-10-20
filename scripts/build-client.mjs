import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { harnessDir } from './harness-dir.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const harnessRoot = harnessDir

// Every browser bundle this repository ships. The harness preset needs a
// workspace manifest to name the plugin, and for the 0.2.0 preset it must sit
// at `packages/<pkg>/<sub>/package.json` inside the harness checkout — hence
// the throwaway directory per target. 0.2.1 reads the package's own manifest
// and ignores the shim.
const targets = [
  {
    name: '@ddvnguyen/moct-dsh-team-room',
    dir: join(projectRoot, 'packages/client-agent-team'),
    manifest: join(projectRoot, 'package.json'),
    env: { DSH_AGENT_TEAM_BUILD_RUNTIME: '1' },
  },
  {
    name: '@ddvnguyen/dsh-side-menu',
    dir: join(projectRoot, 'packages/dsh-side-menu'),
    manifest: join(projectRoot, 'packages/dsh-side-menu/package.json'),
    env: {},
  },
  {
    name: '@ddvnguyen/dsh-sidebar',
    dir: join(projectRoot, 'packages/sidebar'),
    manifest: join(projectRoot, 'packages/sidebar/package.json'),
    env: {},
  },
]

// Optional argument narrows the run to one package (used by that package's own
// `build` script so a standalone build still goes through the shim).
const only = process.argv[2]
const selected = only === undefined ? targets : targets.filter(target => target.name === only || target.dir.endsWith(`/${only}`))
if (selected.length === 0) throw new Error(`build-client: no target matches '${only}'`)

const run = target => new Promise((resolveRun, reject) => {
  // On Windows the pnpm .bin shims are .cmd files and Node 22+ refuses to
  // spawn them without a shell (EINVAL, CVE-2024-27980 follow-up); the POSIX
  // side keeps the direct spawn. shell:true needs the command quoted as one
  // string because the argument list is re-parsed by the shell.
  const bin = join(harnessRoot, 'node_modules/.bin/tsdown')
  const useShell = process.platform === 'win32'
  const env = { ...process.env, ...target.env }
  const child = useShell
    ? spawn(`"${bin}.cmd"`, { shell: true, cwd: target.dir, stdio: 'inherit', env })
    : spawn(bin, [], { cwd: target.dir, stdio: 'inherit', env })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`tsdown exited with ${String(code)} for ${target.name}`)))
})

for (const target of selected) {
  const temporaryPackage = await mkdtemp(join(harnessRoot, 'packages/external-plugin-'))
  const manifestDirectory = join(temporaryPackage, 'bundle')
  try {
    await mkdir(manifestDirectory)
    const manifest = JSON.parse(await readFile(target.manifest, 'utf8'))
    await writeFile(join(manifestDirectory, 'package.json'), JSON.stringify({ name: manifest.name, dsh: manifest.dsh }))
    await run(target)
  } finally {
    await rm(temporaryPackage, { recursive: true, force: true })
  }
}
