// Lists what upstream Contexera/dsh-agent-team has added since the last sync
// review, and how hard each commit will be to bring over.
//
// The sync state lives in scripts/upstream-sync.json: the fork point, the last
// reviewed upstream commit, and every upstream commit already taken or skipped
// (with the reason). `git cherry-pick -x` trailers on our history count as
// taken too, so a pick recorded only in a commit message is still recognised.
// The procedure around this report is docs/development/upstream-sync.md.
//
// Usage: node scripts/upstream-sync.mjs [--ours <ref>] [--no-fetch] [--all] [--json]
//   --ours <ref>  our side to compare (default HEAD)
//   --no-fetch    use the upstream ref already fetched
//   --all         also list commits up to lastReviewed, not only newer ones
//   --json        print the report as JSON instead of text
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'upstream-sync.json'), 'utf8'))

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const ours = option('--ours') ?? 'HEAD'

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const lines = text => text === '' ? [] : text.split('\n')

const { remote, url, branch } = marker.upstream
if (!lines(git('remote')).includes(remote)) git('remote', 'add', remote, url)
if (!flag('--no-fetch')) git('fetch', '--quiet', remote, branch)
const upstreamRef = `${remote}/${branch}`
const upstreamHead = git('rev-parse', upstreamRef)

// Taken: the marker's list plus every -x trailer since the fork point.
const taken = new Map(marker.taken.map(entry => [entry.commit, entry.note ?? `batch ${entry.batch}`]))
for (const match of git('log', '--format=%B', `${marker.forkPoint}..${ours}`).matchAll(/cherry picked from commit ([0-9a-f]{40})/g)) {
  if (!taken.has(match[1])) taken.set(match[1], 'cherry-pick -x trailer')
}
const skipped = new Map(marker.skipped.map(entry => [entry.commit, entry.reason]))

// How far each file on our side differs from the last reviewed upstream
// commit: with every pick up to it taken, that difference is MOCT's own work,
// which is where a new upstream change will conflict.
const diverged = new Map()
for (const row of lines(git('diff', '--numstat', marker.lastReviewed, ours))) {
  const [added, removed, path] = row.split('\t')
  diverged.set(path, (Number(added) || 0) + (Number(removed) || 0))
}
const upstreamFiles = new Set(lines(git('ls-tree', '-r', '--name-only', upstreamRef)))
const moctOnly = lines(git('ls-tree', '-r', '--name-only', ours, '--', 'packages', 'scripts'))
  .filter(path => !upstreamFiles.has(path) && !path.includes('/lib/'))
const hotspots = new Set(marker.hotspots)
const renamedNames = Object.keys(marker.renames)

const reviewed = new Set(lines(git('rev-list', `${marker.forkPoint}..${marker.lastReviewed}`)))
const commits = lines(git('log', '--reverse', '--no-merges', '--format=%H%x09%ad%x09%s', '--date=short', `${marker.forkPoint}..${upstreamRef}`))
  .map(row => {
    const [commit, date, subject] = row.split('\t')
    const status = taken.has(commit) ? 'taken' : skipped.has(commit) ? 'skipped' : reviewed.has(commit) ? 'unrecorded' : 'new'
    const files = lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', commit))
    const diff = git('show', '--format=', commit)
    return {
      commit, short: commit.slice(0, 7), date, subject, status,
      note: taken.get(commit) ?? skipped.get(commit),
      files: files.map(path => ({
        path,
        divergedLines: diverged.get(path) ?? 0,
        hotspot: hotspots.has(path),
      })),
      touchesRenamedName: renamedNames.some(name => diff.includes(name)),
    }
  })
  .filter(entry => flag('--all') || entry.status === 'new' || entry.status === 'unrecorded')

// A file that came over with an upstream package name still in it is the
// commonest silent break: new files apply cleanly, so no conflict flags them.
const staleNames = renamedNames.flatMap(name => {
  try {
    return lines(git('grep', '-l', '-F', name, ours, '--', 'packages', 'scripts')).map(hit => ({ name, path: hit.slice(ours.length + 1) }))
  } catch {
    return []
  }
}).filter(hit => !hit.path.includes('/lib/') && hit.path !== 'scripts/upstream-sync.json')

const report = {
  upstream: { ref: upstreamRef, head: upstreamHead, forkPoint: marker.forkPoint, lastReviewed: marker.lastReviewed, lastReviewedOn: marker.lastReviewedOn },
  ours, moctOnlyFileCount: moctOnly.length, staleNames, commits,
}

if (flag('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const short = commit => commit.slice(0, 7)
  console.log(`upstream ${upstreamRef} at ${short(upstreamHead)}; fork point ${short(marker.forkPoint)}; last reviewed ${short(marker.lastReviewed)} on ${marker.lastReviewedOn}`)
  console.log(`ours ${ours}: ${diverged.size} files differ from ${short(marker.lastReviewed)}, ${moctOnly.length} files under packages/ and scripts/ exist only here\n`)
  if (commits.length === 0) console.log('Nothing new upstream since the last review.')
  for (const entry of commits) {
    const tags = [entry.status, ...(entry.touchesRenamedName ? ['renamed package name'] : [])]
    console.log(`${entry.short} ${entry.date} ${entry.subject}  [${tags.join(', ')}]${entry.note === undefined ? '' : `  ${entry.note}`}`)
    const flagged = entry.files.filter(file => file.hotspot || file.divergedLines > 0)
    for (const file of flagged) {
      const marks = [...(file.hotspot ? ['hotspot'] : []), ...(file.divergedLines > 0 ? [`MOCT differs by ${file.divergedLines} lines`] : [])]
      console.log(`    ${file.path}  (${marks.join('; ')})`)
    }
    const clean = entry.files.length - flagged.length
    if (clean > 0) console.log(`    + ${clean} file${clean === 1 ? '' : 's'} MOCT has not changed`)
  }
  if (staleNames.length > 0) {
    console.log('\nFiles on our side still naming an upstream package (rename them):')
    for (const hit of staleNames) console.log(`    ${hit.path}: ${hit.name} -> ${marker.renames[hit.name]}`)
  }
}
