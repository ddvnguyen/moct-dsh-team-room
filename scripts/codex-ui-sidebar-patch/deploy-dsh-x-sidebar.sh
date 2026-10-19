#!/usr/bin/env bash
# Deploy the MOCT sidebar stack into the dsh-x profile and restart the service.
#
# Steps:
#   1. the profile's package.json points at the new plugin tarballs and the
#      latest codex-ui;
#   2. pnpm install materialises them;
#   3. the codex-ui sidebar patch is applied to the installed codex-ui (the
#      patch is applied by anchored edits, so it survives a codex-ui release
#      that keeps the anchors);
#   4. dsh-x is restarted with the profile's own DSH_HOME.
#
# Usage: deploy-dsh-x-sidebar.sh [--skip-restart]
set -euo pipefail

X=/mnt/workspace/clouds/dsh-x
P=$X/data/home/profiles/web
REPO=${REPO:-/home/ddv/multica_workspaces/moct-27c35c5a56cb/task-2158361e75df/workdir/moct-repo}
MOCT_VERSION=${MOCT_VERSION:-0.0.1-261019.2315}
SIDE_MENU_VERSION=${SIDE_MENU_VERSION:-0.1.3}
CODEX_UI_VERSION=${CODEX_UI_VERSION:-1.1.43}

step() { printf '\n== %s\n' "$1"; }

step "profile package.json"
python3 - "$P" "$MOCT_VERSION" "$SIDE_MENU_VERSION" "$CODEX_UI_VERSION" "$X/artifacts" <<'PY'
import re, sys
profile, moct, side, codex, artifacts = sys.argv[1:6]
path = f"{profile}/package.json"
text = open(path).read()
text = re.sub(r'("@michengai/dsh-codex-ui": ")[^"]+(")', rf'\g<1>{codex}\g<2>', text)
text = re.sub(r'("@ddvnguyen/moct-dsh-team-room": ")[^"]+(")', rf'\g<1>file:{artifacts}/ddvnguyen-moct-dsh-team-room-{moct}.tgz\g<2>', text)
text = re.sub(r'("@ddvnguyen/dsh-side-menu": ")[^"]+(")', rf'\g<1>file:{artifacts}/ddvnguyen-dsh-side-menu-{side}.tgz\g<2>', text)
open(path, "w").write(text)
print(text)
PY

step "pnpm install"
cd "$P"
pnpm install

step "codex-ui sidebar patch"
# The applier is copied next to the profile: the profile's postinstall hook
# runs it after every install, so a codex-ui update can never silently drop
# the patch (which is what removed the Teams tab before).
mkdir -p "$X/scripts/codex-ui-sidebar-patch"
cp "$REPO/scripts/codex-ui-sidebar-patch/edits.mjs" "$X/scripts/codex-ui-sidebar-patch/edits.mjs"
cp "$REPO/scripts/codex-ui-sidebar-patch/apply.mjs" "$X/scripts/codex-ui-sidebar-patch/apply.mjs"
cat > "$X/scripts/apply-codex-ui-sidebar-patch.sh" <<EOF
#!/usr/bin/env bash
# Re-applies the codex-ui sidebar patch to the installed codex-ui.
# Idempotent: an already patched bundle is left alone. A codex-ui release that
# moved an anchor fails here, loudly, instead of shipping a sidebar without
# the Teams tab.
set -euo pipefail
exec node "$X/scripts/codex-ui-sidebar-patch/apply.mjs" \\
  "$P/node_modules/@michengai/dsh-codex-ui" "\$@"
EOF
chmod +x "$X/scripts/apply-codex-ui-sidebar-patch.sh"
node "$REPO/scripts/codex-ui-sidebar-patch/apply.mjs" "$P/node_modules/@michengai/dsh-codex-ui"

step "profile postinstall hook"
python3 - "$P" <<'PY'
import json, sys
path = f"{sys.argv[1]}/package.json"
data = json.load(open(path))
scripts = data.get("scripts", {})
scripts["postinstall"] = "bash /mnt/workspace/clouds/dsh-x/scripts/apply-codex-ui-sidebar-patch.sh"
data["scripts"] = scripts
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
print(json.dumps(data.get("scripts"), indent=2))
PY

if [ "${1:-}" = "--skip-restart" ]; then
  exit 0
fi

step "restart dsh-x"
# Only the process that owns the dsh-x port is stopped: other instances of the
# same launcher (rehearsals, the production profile) keep running.
PORT_PID=$(ss -ltnp 2>/dev/null | sed -n 's/.*:3181 .*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$PORT_PID" ]; then
  kill "$PORT_PID" || true
  for _ in $(seq 1 20); do
    kill -0 "$PORT_PID" 2>/dev/null || break
    sleep 1
  done
fi
cd /home/ddv
DSH_HOME=$X/data/home setsid nohup /home/ddv/.nvm/versions/node/v24.15.0/bin/node \
  $X/current/apps/cli/lib/bin.js --profile web --patch $X/data/overlay.yml \
  --host 0.0.0.0 --port 3181 --no-open \
  --trusted-host dsh-x.ddvnguyen.com --trusted-host localhost --trusted-host 127.0.0.1 --trusted-host 192.168.7.99 \
  >> $X/logs/dsh-x.log 2>&1 < /dev/null &
sleep 25
curl -s -o /dev/null -w "dsh-x http %{http_code}\n" http://127.0.0.1:3181/
