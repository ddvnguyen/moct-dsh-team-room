#!/usr/bin/env node
/**
 * Generate the reviewable diff of the codex-ui sidebar patch for one release.
 *
 * The diff is an artefact for review and audit; the patch itself is applied by
 * the anchored edits (see `./edits.mjs`). Regenerating it for a new release
 * is therefore only about producing the artefact, not about re-authoring the
 * change: the generator downloads the published bundle, applies the edits and
 * writes the unified diff.
 *
 * Usage:
 *   node scripts/codex-ui-sidebar-patch/generate.mjs <version> [--out <dir>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySidebarPatch } from './edits.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packageName = '@michengai/dsh-codex-ui'

function main(argv) {
  const version = argv.find((arg) => !arg.startsWith('--'))
  if (version === undefined) {
    console.error('usage: generate.mjs <version> [--out <dir>]')
    return 2
  }
  const outIndex = argv.indexOf('--out')
  const outDir = resolve(outIndex === -1 ? join(repoRoot, 'patches') : argv[outIndex + 1])
  const work = mkdtempSync(join(tmpdir(), 'codex-ui-patch-'))
  try {
    execFileSync('npm', ['pack', `${packageName}@${version}`, '--silent'], { cwd: work, stdio: 'inherit' })
    const tarball = readFileSync(join(work, 'package', 'lib', 'client.js'), 'utf8')
    const patched = applySidebarPatch(tarball)
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `codex-ui-${version}-sidebar.diff`)
    writeFileSync(outFile, unifiedDiff(`a/lib/client.js`, `b/lib/client.js`, tarball, patched.source))
    console.log(`wrote ${outFile} (${patched.applied.length} edits)`)
    return 0
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    return 3
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** A minimal unified diff: the hunks the edits produced, with 3 lines of context. */
function unifiedDiff(oldName, newName, oldText, newText) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const hunks = []
  let index = 0
  while (index < oldLines.length) {
    if (oldLines[index] === newLines[index]) {
      index += 1
      continue
    }
    const start = Math.max(0, index - 3)
    let oldEnd = index
    let newEnd = index
    while (oldEnd < oldLines.length && newEnd < newLines.length && oldLines[oldEnd] !== newLines[newEnd]) {
      oldEnd += 1
      newEnd += 1
    }
    hunks.push({ start, oldLines: oldLines.slice(start, oldEnd + 3), newLines: newLines.slice(start, newEnd + 3) })
    index = oldEnd
  }
  let out = `--- ${oldName}\n+++ ${newName}\n`
  for (const hunk of hunks) {
    out += `@@ -${hunk.start + 1},${hunk.oldLines.length} +${hunk.start + 1},${hunk.newLines.length} @@\n`
    for (const line of hunk.oldLines) out += `-${line}\n`
    for (const line of hunk.newLines) out += `+${line}\n`
  }
  return out
}

process.exit(main(process.argv.slice(2)))
