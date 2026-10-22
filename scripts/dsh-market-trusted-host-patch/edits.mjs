/**
 * The dsh-market trusted-authority patch, expressed as anchored edits instead
 * of a diff.
 *
 * Why edits and not a diff: the fence this patch changes is the market's own
 * security boundary, and a diff is pinned to one published file layout. A
 * market release that keeps the anchors needs no new patch file; a release
 * that moves one fails loudly, with the anchor's id, and the installed
 * package is left untouched. That is the property that matters here: a patch
 * that silently stopped applying would leave a lane where the privileged
 * routes refuse, with nothing in the deploy log saying so.
 *
 * What the patch changes:
 *
 * The market's ordinary routes honour the host's DECLARED authorities
 * (`dsh web --trusted-host <name>`) through `sameOrigin` — the host's
 * `connection.trustedHosts` list. Its privileged routes (the backup export,
 * the self-uninstall, the one-click restart) did not: they demanded a direct
 * loopback peer. A lane reached through the Cloudflare tunnel dials
 * `10.88.0.1:318x`, so the peer is the proxy and every privileged route
 * answered 403 "limited to same-origin loopback requests" while every
 * ordinary route answered 200.
 *
 * The patch gives the privileged routes the same authority rule the ordinary
 * ones already have, and keeps everything that protects them:
 *
 * - an UNDECLARED name is still refused — the trust is the host's own
 *   declaration, never "anything";
 * - a LOOPBACK Host still has to arrive from a loopback peer, so a remote
 *   client cannot borrow one even when the deployment declares it;
 * - a browser that labels the request cross-site (`sec-fetch-site`) is
 *   refused outright, as `sameOrigin` and the host's own fence do;
 * - a present `Origin` must still name the `Host`.
 *
 * This mirrors the upstream change (dsh-market PR #958, merged into `main` on
 * 2026-10-20). PR #956 was the original change; it was closed without being
 * merged, and #958 carries the same fence change and completes it. When that
 * lands in a release, this patch has nothing left to do: the applier
 * recognises the shipped implementation and leaves the package alone. Until
 * then the lanes get the behaviour now.
 *
 * Every edit asserts its anchor. An anchor that is missing means the
 * published bundle changed shape: the applier stops and reports it instead
 * of writing a half-patched package.
 */

/**
 * The marker the applier looks for to recognise an already patched file.
 *
 * It is the name of the shared predicate the patch introduces, so a file that
 * carries it is either this patch's output or a release that shipped the
 * same fix — both are states where patching again would be wrong.
 */
export const PATCH_MARKER = 'servedAuthority'

/** The marker of the accessor the patch adds to the fence's own module. */
export const ACCESSOR_MARKER = 'declaredTrustedHosts'

/**
 * The edit list, per file.
 *
 * Each edit is one exact replacement: `from` must appear exactly once in the
 * file, and `to` replaces it.
 */
export const EDITS = {
  'lib/http.js': [
    {
      id: 'http-declared-trusted-hosts',
      from: `/** Point the fence at the host's declared authorities. Returns the previous source. */
export function setTrustedHostsSource(source) {
    const previous = trustedHostsSource;
    trustedHostsSource = source;
    return previous;
}
`,
      to: `/** Point the fence at the host's declared authorities. Returns the previous source. */
export function setTrustedHostsSource(source) {
    const previous = trustedHostsSource;
    trustedHostsSource = source;
    return previous;
}
/**
 * The authorities this deployment declared, as the fence reads them right now.
 *
 * \`sameOrigin\` consults them through the private source above; the privileged
 * routes in \`restart.js\` need the same list, and a second private copy of it
 * would be a second thing to keep in step.
 */
export function declaredTrustedHosts() {
    return trustedHostsSource();
}
`,
    },
  ],
  'lib/restart.js': [
    {
      id: 'restart-import-declared-hosts',
      from: `import { loopbackAuthority } from './http.js';
`,
      to: `import { declaredTrustedHosts, loopbackAuthority, trustedAuthority } from './http.js';
`,
    },
    {
      id: 'restart-served-authority',
      from: `    return loopbackAuthority(request.headers.host);
}
/**
 * Whether a restart request made from the same page as THIS request could pass
`,
      to: `    return loopbackAuthority(request.headers.host);
}
/**
 * Whether the request's Host names an authority the HOST declared —
 * \`dsh web --trusted-host <name>\` — as the ordinary route fence reads it.
 *
 * A declared authority is the operator's own statement about the name this
 * deployment serves, and it is the same statement the host's own fence
 * accepts for every other request on the host.
 *
 * A LOOPBACK authority is deliberately not this path: the lane deployments
 * declare \`127.0.0.1\` alongside their public name, and a loopback Host is the
 * direct path's business, where the peer's address is checked as well.
 */
function declaredAuthority(request) {
    const host = request.headers.host;
    if (host === undefined)
        return false;
    if (loopbackAuthority(host))
        return false;
    return trustedAuthority(host, declaredTrustedHosts());
}
/**
 * Whether the request names an authority this deployment serves, and is not a
 * cross-site request.
 *
 * Two shapes, and a deployment has to be one of them:
 *
 * - DIRECT: a loopback peer, no forwarding trace, and a loopback Host.
 * - THROUGH THE PERIMETER: a Host the host DECLARED. The peer is then the
 *   proxy (a tunnel, an Ingress) and a forwarding trace is expected rather
 *   than suspicious, so the peer is not what decides — the declared Host is.
 *
 * What still holds in both: the Host is the header an attacker's page cannot
 * forge, an undeclared name is refused, and a browser that labels the request
 * cross-site is refused outright.
 */
function servedAuthority(request) {
    if (request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    if (declaredAuthority(request))
        return true;
    return directLoopbackRequest(request);
}
/**
 * Whether an \`Origin\` header names the same authority as the \`Host\` header.
 *
 * The \`null\` origin (a sandboxed iframe, a \`data:\` document) is a
 * present-but-unparseable origin and is refused.
 */
function sameAuthorityOrigin(origin, host) {
    if (origin === undefined)
        return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
    }
    catch {
        return false;
    }
}
/**
 * Whether a restart request made from the same page as THIS request could pass
`,
    },
    {
      id: 'restart-reachable-from',
      from: `export function restartReachableFrom(request) {
    return directLoopbackRequest(request);
}
`,
      to: `export function restartReachableFrom(request) {
    return servedAuthority(request);
}
`,
    },
    {
      id: 'restart-self-uninstall-reachable-from',
      from: `export function selfUninstallReachableFrom(request) {
    return trustedSelfUninstallRequest(request);
}
`,
      to: `export function selfUninstallReachableFrom(request) {
    return servedAuthority(request) || desktopForwardedRequest(request);
}
`,
    },
    {
      id: 'restart-trusted-restart-request',
      from: `export function trustedRestartRequest(request) {
    if (!directLoopbackRequest(request))
        return false;
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin === undefined || host === undefined)
        return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
    }
    catch {
        return false;
    }
}
`,
      to: `export function trustedRestartRequest(request) {
    if (!servedAuthority(request))
        return false;
    const host = request.headers.host;
    if (host === undefined)
        return false;
    // Process control always carries an Origin: the button is a page's own
    // request, and a request without one is not a page's request.
    return sameAuthorityOrigin(request.headers.origin, host);
}
`,
    },
    {
      id: 'restart-trusted-download-request',
      from: `export function trustedDownloadRequest(request) {
    const address = request.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')
        return false;
    if (request.headers.forwarded !== undefined
        || request.headers['x-forwarded-for'] !== undefined
        || request.headers['x-real-ip'] !== undefined)
        return false;
    const origin = request.headers.origin;
    const host = request.headers.host;
    // Same rebinding rule as the restart fence above (#678).
    if (!loopbackAuthority(host))
        return false;
    if (origin === undefined)
        return true; // plain browser download navigation
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
    }
    catch {
        return false;
    }
}
`,
      to: `export function trustedDownloadRequest(request) {
    if (!servedAuthority(request))
        return false;
    const host = request.headers.host;
    if (host === undefined)
        return false;
    const origin = request.headers.origin;
    if (origin === undefined)
        return true; // plain browser download navigation
    return sameAuthorityOrigin(origin, host);
}
`,
    },
  ],
}

/**
 * Apply every edit of one file to its source.
 *
 * @param {string} file - the file the edits belong to.
 * @param {string} source - the file's current source.
 * @returns {{ source: string, applied: string[] }} the patched source and the applied edit ids
 * @throws when an anchor is missing or ambiguous: the caller must not write a
 *   file it could not patch completely.
 */
export function applyMarketPatch(file, source) {
  const edits = EDITS[file]
  if (edits === undefined) throw new Error(`dsh-market patch: no edits are declared for ${file}`)
  let patched = source
  const applied = []
  for (const edit of edits) {
    const first = patched.indexOf(edit.from)
    if (first === -1) {
      throw new Error(`dsh-market patch: anchor for edit "${edit.id}" in ${file} is missing. The published package changed shape; review the edit before applying it.`)
    }
    if (patched.indexOf(edit.from, first + 1) !== -1) {
      throw new Error(`dsh-market patch: anchor for edit "${edit.id}" in ${file} is ambiguous (appears more than once).`)
    }
    patched = patched.slice(0, first) + edit.to + patched.slice(first + edit.from.length)
    applied.push(edit.id)
  }
  return { source: patched, applied }
}
