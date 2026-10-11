#!/usr/bin/env bash
# Live-bundle cross-check for D2's host contract, against the *installed*
# @michengai/dsh-automation. Every fact D2's code relies on is printed from the
# real bundle, so a future version bump is a one-command audit: re-run this, and
# anything that moved shows up as a changed line.
#
# Deliberately a machine fact, not a repo dependency — the specs pin the
# constants as literals (see HOST_CONTRACT) and never read node fs.
set -uo pipefail

BUNDLE="${1:-/home/ddv/dsh-test/profiles/web/node_modules/@michengai/dsh-automation/lib/client.js}"

if [[ ! -f "$BUNDLE" ]]; then
  echo "MISSING: $BUNDLE" >&2
  exit 2
fi

echo "bundle: $BUNDLE"
echo "md5:    $(md5sum "$BUNDLE" | cut -d' ' -f1)"
for profile in /home/ddv/.dsh/profiles/web /home/ddv/.dsh/profiles/web-trial /home/ddv/dsh-test/profiles/web; do
  pkg="$profile/node_modules/@michengai/dsh-automation/package.json"
  [[ -f "$pkg" ]] || continue
  echo "version: $(node -e "process.stdout.write(require('$pkg').version)")  ($profile)"
done
echo

# One fact per line, each grepped from the bundle itself. A missing line is a
# contract change, not a formatting artifact.
check() {
  local label="$1" pattern="$2"
  if grep -q -- "$pattern" "$BUNDLE"; then
    echo "OK   $label"
  else
    echo "GONE $label   (expected pattern: $pattern)"
  fi
}

check "registry key literal __dshNativeTabs"            'var mO="__dshNativeTabs"'
check "registry factory shape version:1 + insert"       'version:1,officialTree:e'
check "feature-detect requires typeof insert function"  'typeof t.insert=="function"'
check "two-step discovery KS(entry) ?? KS(component)"   'return KS(e)??KS(t?.component)'
check "attach slot sidebar.workspaces"                  'e.slots.inject("sidebar.workspaces"'
check "entry reader entriesOfSlot ?? entries"           'e.slots.entriesOfSlot??e.slots.entries'
check "subscribes to sidebar.workspaces"                'e.slots.subscribe("sidebar.workspaces",w)'
check "subscribes to sidebar (parent)"                  'e.slots.subscribe?.("sidebar",w)'
check "window re-probe event name"                      'new Event("dsh-native-sidebar-change")'
check "owner retry budget 20 x 250 ms"                  'N+=1,(v()||N>=20)&&x()},250'
check "tab sort order ?? 0"                             '(a.order??0)-(c.order??0)'
check "insert requires non-empty id"                    'if(a.id==="")return()=>{}'
check "strip renders tasks, registry tabs, channels, schedule" 'role:"tablist","aria-label"'
check "selected body container class"                   'className:"dsh-st-shell-body"'
check "persistence key literal"                         ',dh="dsh-automation.sidebar-tab"'
check "persistence whitelist collapses to tasks"        'return e==="channels"||e==="schedule"||e==="tasks"?e:"tasks"'

echo
echo "expected for D2 (from evidence/D2-initial.md section 1):"
echo "  registryKey __dshNativeTabs / registrySlot sidebar.workspaces / siblingSlot sidebar"
echo "  tabId team / tabOrder 3 / retry 250 ms x 20"
