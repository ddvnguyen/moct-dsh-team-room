// Mechanical gate for the Multica reuse policy (epic #124).
//
// Files ported from multica-x must say where they came from and which upstream
// commit they were copied at, and the Client must never depend on Multica's own
// packages: `@multica/core` and friends are bound to Multica's server API, so
// an import would pull that backend in through the back door.
//
// Three facts are asserted:
// (a) every file under the ported directories (and the look layer stylesheet)
//     opens with a `Derived from multica-x <path> @ <commit>` header naming
//     the Multica License, and any other file that mentions `multica-x` in its
//     opening comment carries the same well-formed header;
// (b) no Client source imports a `@multica/*` specifier;
// (c) every upstream commit named in a header is pinned in NOTICE, so an
//     upstream change can be diffed instead of rediscovered.
//
// It runs standalone, like the other `check:*` gates. `--root <dir>` points the
// same checks at another tree (the spec drives it that way).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootFlag = process.argv.indexOf('--root')
const root = rootFlag === -1 ? repositoryRoot : resolve(process.argv[rootFlag + 1])

const clientSource = 'packages/client-agent-team/src/client'
const portedDirectories = [`${clientSource}/multica`, `${clientSource}/multica-ui`]
const portedFiles = [`${clientSource}/multica-look.module.css`]
const sourceExtension = /\.(?:ts|tsx|css)$/u
const headerPattern = /Derived from multica-x\s+\S[\s\S]*?@\s+([0-9a-f]{40})\b[\s\S]*?Copyright Index Labs\.\s+Multica License\./u
const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]@multica\//u

const failures = []

function listFiles(directory) {
  const absolute = join(root, directory)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return sourceExtension.test(entry.name) ? [path] : []
  })
}

/** The file's opening comment block with the comment markers removed. */
function leadingComment(text) {
  const lines = text.split('\n')
  const out = []
  let inBlock = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) {
        out.push(trimmed.replace(/\*\/.*$/u, '').replace(/^\*\s?/u, ''))
        break
      }
      out.push(trimmed.replace(/^\*\s?/u, ''))
    } else if (trimmed.startsWith('/*')) {
      inBlock = !trimmed.includes('*/')
      out.push(trimmed.replace(/^\/\*+\s?/u, '').replace(/\*\/.*$/u, ''))
      if (!inBlock) break
    } else if (trimmed.startsWith('//')) {
      out.push(trimmed.replace(/^\/\/\s?/u, ''))
    } else {
      break
    }
  }
  return out.join(' ').replace(/\s+/gu, ' ').trim()
}

const clientFiles = listFiles(clientSource)
const portedPaths = new Set([
  ...portedDirectories.flatMap(listFiles),
  ...portedFiles.filter((path) => existsSync(join(root, path))),
])
const pinned = new Set()

for (const path of clientFiles) {
  const text = readFileSync(join(root, path), 'utf8')
  const name = relative(root, join(root, path))
  if (importPattern.test(text)) {
    failures.push(`${name}: imports a @multica/* package; port the logic instead of depending on Multica's server-bound packages`)
  }
  const comment = leadingComment(text)
  const mentionsUpstream = /multica-x/u.test(comment)
  if (!portedPaths.has(path) && !mentionsUpstream) continue
  const match = headerPattern.exec(comment)
  if (match === null) {
    failures.push(`${name}: missing or malformed header; expected "Derived from multica-x <path> @ <40-hex commit>. Copyright Index Labs. Multica License."`)
    continue
  }
  pinned.add(match[1])
}

const noticePath = join(root, 'NOTICE')
const notice = existsSync(noticePath) && statSync(noticePath).isFile() ? readFileSync(noticePath, 'utf8') : ''
if (pinned.size > 0 && notice === '') failures.push('NOTICE is missing but derived files exist')
for (const commit of pinned) {
  if (notice !== '' && !notice.includes(commit)) failures.push(`NOTICE does not pin upstream commit ${commit}`)
}

if (failures.length > 0) {
  console.error(`check-multica-provenance: ${failures.length} problem(s)\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log(`check-multica-provenance: ${portedPaths.size} ported file(s), ${pinned.size} pinned upstream commit(s) OK`)
