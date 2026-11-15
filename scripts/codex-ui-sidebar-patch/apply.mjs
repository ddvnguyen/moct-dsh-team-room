#!/usr/bin/env node
/**
 * Apply the codex-ui sidebar patch to an installed `@michengai/dsh-codex-ui`.
 *
 * The patch is applied by anchored edits (see `./edits.mjs`), not by a
 * line-based diff, so a codex-ui release that keeps the anchors needs no new
 * patch file. The edit list carries one set per bundle SHAPE (the 1.x tab
 * strip, the 2.x sidebar nav); the set whose anchors all match is the one
 *
 * Usage:
 *   node scripts/codex-ui-sidebar-patch/apply.mjs <codex-ui-package-dir> [--check|--verify]
 *
 * `--check` reports what would happen and exits 0 without writing.
 * `--verify` asserts that the installed package already carries the patch,
 * which is what the deploy runs after applying it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { applyServerPatch, applySidebarPatch, PATCH_MARKER, SERVER_PATCH_MARKER } from './edits.mjs'

/**
 * Parse-check the patched bundle before it is written.
 *
 * A patch that produces a bundle the browser cannot parse breaks the whole
 * sidebar, and the failure surfaces in the browser console, not here. The
 * check is a parse, not a run: it catches a malformed edit (a dropped
 * variable, a broken template) and leaves the installed bundle untouched.
 *
 * The scratch directory sits BESIDE the bundle being written — never in
 * `tmpdir()` (moct#30's rule): it is on the same filesystem as the output, so
 * a host whose `/tmp` is a small shared tmpfs (or full) cannot kill the
 * install with ENOSPC, and the write stays single-device.
 */
function parses(source, directory) {
  const work = mkdtempSync(join(directory, '.patch-check-'))
  try {
    const file = join(work, 'client.mjs')
    writeFileSync(file, source)
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    return undefined
  } catch (error) {
    const output = error.stderr?.toString() ?? String(error)
    return output.split('\n').slice(0, 6).join('\n')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function readVersion(packageDir) {
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) return 'unknown'
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function main(argv) {
  const check = argv.includes('--check')
  const verify = argv.includes('--verify')
  const target = argv.find((arg) => !arg.startsWith('--'))
  if (target === undefined) {
    console.error('usage: apply.mjs <codex-ui-package-dir> [--check]')
    return 2
  }
  const packageDir = resolve(target)
  const bundle = join(packageDir, 'lib', 'client.js')
  const serverBundle = join(packageDir, 'lib', 'index.mjs')
  const backup = join(dirname(bundle), 'client.js.orig')
  if (!existsSync(bundle)) {
    console.error(`no client bundle at ${bundle}`)
    return 2
  }
  const serverExists = existsSync(serverBundle)
  let source = readFileSync(bundle, 'utf8')
  // The server half (`lib/index.mjs`) carries the session-gate compat
  // (M-377): without it the merged harness 503s every business REST route.
  // The applier verifies it the same way it verifies the sidebar patch.
  if (verify) {
    // The bundle as it is installed, not the pristine copy next to it: the
    // question is whether the package the lane will serve carries the
    // patch.
    if (!source.includes(PATCH_MARKER)) {
      console.error(`codex-ui ${readVersion(packageDir)} does not carry the sidebar patch (${PATCH_MARKER} is absent)`)
      return 1
    }
    if (serverExists) {
      const serverSource = readFileSync(serverBundle, 'utf8')
      if (!serverSource.includes(SERVER_PATCH_MARKER) && serverSource.includes('requestRejection')) {
        console.error(`codex-ui ${readVersion(packageDir)} does not carry the server session-gate compat (${SERVER_PATCH_MARKER} is absent)`)
        return 1
      }
    }
    console.log(`codex-ui ${readVersion(packageDir)} carries the sidebar patch`)
    return 0
  }
  if (source.includes(PATCH_MARKER)) {
    // The bundle already carries the patch. The pristine copy kept next to it
    // is the input for the current edit set, so a changed edit list is applied
    // to the original rather than to an already patched bundle.
    if (!existsSync(backup)) {
      console.log(`already patched (${PATCH_MARKER} present)`)
      return 0
    }
    source = readFileSync(backup, 'utf8')
  }
  let patched
  try {
    patched = applySidebarPatch(source)
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    return 3
  }
  const parseError = parses(patched.source, dirname(bundle))
  if (parseError !== undefined) {
    console.error(`the patched bundle does not parse; the installed bundle was left untouched:\n${parseError}`)
    return 4
  }
  if (check) {
    console.log(`patch applies cleanly to ${readVersion(packageDir)} via "${patched.set}" (${patched.applied.length} edits)`)
    if (serverExists) {
      const serverSource = readFileSync(serverBundle, 'utf8')
      try {
        const serverPatched = applyServerPatch(serverSource)
        console.log(`server compat: ${serverPatched.applied.length} applied, ${serverPatched.skipped.length} skipped`)
      } catch (error) {
        console.error(String(error instanceof Error ? error.message : error))
        return 3
      }
    }
    return 0
  }
  if (!existsSync(backup)) copyFileSync(bundle, backup)
  writeFileSync(bundle, patched.source)
  console.log(`patched ${basename(packageDir)} ${readVersion(packageDir)} via "${patched.set}" (${patched.applied.length} edits); original kept at ${backup}`)
  if (serverExists) {
    const serverSource = readFileSync(serverBundle, 'utf8')
    let serverPatched
    try {
      serverPatched = applyServerPatch(serverSource)
    } catch (error) {
      console.error(String(error instanceof Error ? error.message : error))
      return 3
    }
    if (serverPatched.applied.length > 0) {
      const serverBackup = join(dirname(serverBundle), 'index.mjs.orig')
      const parseError = parses(serverPatched.source, dirname(serverBundle))
      if (parseError !== undefined) {
        console.error(`the patched server bundle does not parse; the installed bundle was left untouched:\n${parseError}`)
        return 4
      }
      if (!existsSync(serverBackup)) copyFileSync(serverBundle, serverBackup)
      writeFileSync(serverBundle, serverPatched.source)
      console.log(`patched server half ${basename(packageDir)} ${readVersion(packageDir)} (${serverPatched.applied.length} edits); original kept at ${serverBackup}`)
    } else {
      console.log(`server half already compatible (${serverPatched.skipped.join(', ') || 'nothing to do'})`)
    }
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
