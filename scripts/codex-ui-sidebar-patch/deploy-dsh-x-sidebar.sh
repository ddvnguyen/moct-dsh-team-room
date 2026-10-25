#!/usr/bin/env bash
# Deploy the MOCT sidebar stack into a lane's profile and hand the lane's
# restart to its systemd unit.
#
# The unit owns the lane: the port, the flags (host, port, trusted hosts), the
# team environment (MOCT_TEAM_URL / MOCT_TEAM_WORKSPACE) and the restart. This
# script therefore never kills a listener, never hand-launches the host, and
# never installs into a profile the train owns while the lane is running. The
# hand-launch it replaced is the 2026-10-20 05:38Z outage: it passed DSH_HOME
# alone, the team plugin fell back to its local sqlite store, the Teams tab
# rendered an empty room, and the health check still printed `http 200`.
#
# Steps:
#   1. preflight — the unit must exist, and the lane's port must belong to the
#      unit's MainPID. A listener the unit does not own is refused, named, and
#      left alone;
#   2. profile install — only when the unit is inactive (a first install or a
#      scratch lane). The manifest rewrite and the install travel together:
#      doing one without the other desyncs the manifest from the installed
#      tree. On a live lane the profile belongs to the train
#      (scripts/deploy/dsh-customizations-deploy.sh);
#   3. the codex-ui sidebar patch is applied to the installed codex-ui (by
#      anchored edits, so a codex-ui release that keeps the anchors needs no new
#      patch), the lane's copy of the applier is refreshed, and the profile's
#      postinstall hook re-applies the patch after every install. These run
#      whenever the profile is present — they are what keeps the Teams tab from
#      disappearing on a codex-ui update, so they are never gated with the
#      install;
#   4. the lane is restarted through its unit, and the room is verified against
#      the MOCT team backend by verify-team-room.mjs, which fails the deploy
#      when the lane answers for anything but the migrated room.
#
# Usage:
#   deploy-dsh-x-sidebar.sh [--skip-restart] [--restart-only] [--verify-only]
#     --skip-restart    stop after the patch steps: no restart, no verification
#     --restart-only    preflight + patch refresh + restart + verify
#     --verify-only     preflight + verification; touches nothing
#
# The profile install has no flag: it runs only while the unit is not running,
# and an active lane is the train's to install into. To install here yourself,
# stop the unit first — this script starts it again either way.
#
# UNIT / X / P / UNIT_FILE / REPO may be overridden from the environment; they
# default to the dsh-x lane and to this repository's own tree.
set -euo pipefail

UNIT=${UNIT:-dsh-x}
X=${X:-/mnt/workspace/clouds/$UNIT}
P=${P:-$X/data/home/profiles/web}
UNIT_FILE=${UNIT_FILE:-$HOME/.config/systemd/user/$UNIT.service}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=${REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}
MOCT_VERSION=${MOCT_VERSION:-0.0.1-261019.2315}
SIDEBAR_VERSION=${SIDEBAR_VERSION:-0.1.0}
CODEX_UI_VERSION=${CODEX_UI_VERSION:-1.1.43}

step() { printf '\n== %s\n' "$1"; }
die()  { printf 'deploy-dsh-x-sidebar: %s\n' "$1" >&2; exit 1; }

FLAG_SKIP_RESTART=0
FLAG_RESTART_ONLY=0
FLAG_VERIFY_ONLY=0
for argument in "$@"; do
  case "$argument" in
    --skip-restart)  FLAG_SKIP_RESTART=1 ;;
    --restart-only)  FLAG_RESTART_ONLY=1 ;;
    --verify-only)   FLAG_VERIFY_ONLY=1 ;;
    *) die "unknown argument '$argument' (see the usage header)" ;;
  esac
done
[ "$FLAG_SKIP_RESTART" = 0 ] || [ "$FLAG_RESTART_ONLY" = 0 ] || die "--skip-restart and --restart-only contradict each other"
[ "$FLAG_SKIP_RESTART" = 0 ] || [ "$FLAG_VERIFY_ONLY" = 0 ] || die "--skip-restart and --verify-only contradict each other"
[ "$FLAG_RESTART_ONLY" = 0 ] || [ "$FLAG_VERIFY_ONLY" = 0 ] || die "--restart-only and --verify-only contradict each other"

step "preflight $UNIT"
# The unit file is the lane's contract, and this script's only source of the
# lane's flags: restating them here is how the hand-launch drifted (its
# trusted-host list was already missing the tunnel peer the unit trusts).
[ -f "$UNIT_FILE" ] || die "no unit at $UNIT_FILE — the lane's lifecycle belongs to it. Install it: systemctl --user enable --now $UNIT"

PORT=$(sed -n 's/^ExecStart=.*--port \([0-9][0-9]*\).*/\1/p' "$UNIT_FILE" | head -1)
[ -n "$PORT" ] || die "$UNIT_FILE has no --port in ExecStart"

MAIN_PID=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null || true)
HOLDER=$(ss -ltnp 2>/dev/null | sed -n "s/.*:$PORT .*pid=\([0-9]*\).*/\1/p" | head -1)
if [ -n "$HOLDER" ] && [ "$HOLDER" != "$MAIN_PID" ]; then
  HOLDER_CMDLINE=$(tr '\0' ' ' < "/proc/$HOLDER/cmdline" 2>/dev/null || echo unknown)
  HOLDER_CGROUP=$(tail -n 1 "/proc/$HOLDER/cgroup" 2>/dev/null || echo unknown)
  die ":$PORT is held by pid $HOLDER ($HOLDER_CMDLINE), cgroup $HOLDER_CGROUP — not $UNIT.service (MainPID ${MAIN_PID:-none}). This script never kills a listener it does not own: stop that process deliberately, then re-run."
fi
printf 'port :%s belongs to %s (MainPID %s)\n' "$PORT" "$UNIT" "${MAIN_PID:-not started}"

# The install belongs to the train while the lane runs: the profile's manifest
# is the train's to write, and a bare run of this script used to point it at
# stale tarballs and then install them into a live lane. There is no override
# flag: the only way to install here is to stop the unit first, which is what
# the message says, and this script starts the unit again either way.
UNIT_STATE=$(systemctl --user is-active "$UNIT" 2>/dev/null || true)
INSTALL_PROFILE=1
if [ "$UNIT_STATE" = "active" ] || [ "$UNIT_STATE" = "activating" ]; then
  printf 'profile install is the train'"'"'s job (scripts/deploy/dsh-customizations-deploy.sh); this script hands %s'"'"' restart to its unit and verifies the room. Stop the unit first to install here yourself.\n' "$UNIT"
  INSTALL_PROFILE=0
fi

if [ "$FLAG_VERIFY_ONLY" = 1 ]; then
  step "verify $UNIT"
  exec node "$SCRIPT_DIR/verify-team-room.mjs" --unit-file "$UNIT_FILE" --data-dir "$X/data"
fi

if [ "$FLAG_RESTART_ONLY" = 1 ] || [ "$INSTALL_PROFILE" = 0 ]; then
  if [ "$FLAG_RESTART_ONLY" = 1 ]; then
    printf 'restart-only: the profile install is skipped on purpose.\n'
  fi
else
  step "profile package.json"
  python3 - "$P" "$MOCT_VERSION" "$SIDEBAR_VERSION" "$CODEX_UI_VERSION" "$X/artifacts" <<'PY'
import re, sys
profile, moct, sidebar, codex, artifacts = sys.argv[1:6]
path = f"{profile}/package.json"
text = open(path).read()
text = re.sub(r'("@michengai/dsh-codex-ui": ")[^"]+(")', rf'\g<1>{codex}\g<2>', text)
text = re.sub(r'("@ddvnguyen/moct-dsh-team-room": ")[^"]+(")', rf'\g<1>file:{artifacts}/ddvnguyen-moct-dsh-team-room-{moct}.tgz\g<2>', text)
text = re.sub(r'("@ddvnguyen/dsh-sidebar": ")[^"]+(")', rf'\g<1>file:{artifacts}/ddvnguyen-dsh-sidebar-{sidebar}.tgz\g<2>', text)
open(path, "w").write(text)
print(text)
PY

  step "pnpm install"
  (cd "$P" && pnpm install)
fi

step "codex-ui sidebar patch"
# The applier is copied next to the profile, and the profile's postinstall hook
# runs it after every install, so a codex-ui update can never silently drop the
# patch (which is what removed the Teams tab before). This is the only path
# that refreshes the lane's copy of the applier, so it runs whether or not the
# install ran.
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
if [ -f "$P/package.json" ]; then
  node "$REPO/scripts/codex-ui-sidebar-patch/apply.mjs" "$P/node_modules/@michengai/dsh-codex-ui"

  step "profile postinstall hook"
  python3 - "$P" "$X" <<'PY'
import json, sys
profile, lane = sys.argv[1], sys.argv[2]
path = f"{profile}/package.json"
data = json.load(open(path))
scripts = data.get("scripts", {})
scripts["postinstall"] = f"bash {lane}/scripts/apply-codex-ui-sidebar-patch.sh"
data["scripts"] = scripts
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
print(json.dumps(data.get("scripts"), indent=2))
PY
else
  printf 'no profile at %s — the train creates it; the applier copy is in place for it.\n' "$P"
fi

if [ "$FLAG_SKIP_RESTART" = 1 ]; then
  printf '\n--skip-restart: %s left running, the patch steps done.\n' "$UNIT"
  exit 0
fi

step "restart $UNIT"
systemctl --user restart "$UNIT"
for _ in $(seq 1 60); do
  [ "$(systemctl --user is-active "$UNIT" 2>/dev/null || true)" = "active" ] && break
  sleep 1
done
if [ "$(systemctl --user is-active "$UNIT" 2>/dev/null || true)" != "active" ]; then
  systemctl --user status "$UNIT" --no-pager -l -n 40 >&2 || true
  die "$UNIT is not active 60s after the restart"
fi

# A unit cycling on a port it lost is "active" at the sampled instant; that
# cycling is the 37-restart symptom of the 05:38Z outage. The pid and the
# restart counter are what a state string cannot fake.
PID_AFTER_RESTART=$(systemctl --user show -p MainPID --value "$UNIT")
RESTARTS_AFTER_RESTART=$(systemctl --user show -p NRestarts --value "$UNIT" 2>/dev/null || echo 0)
sleep 3
PID_LATER=$(systemctl --user show -p MainPID --value "$UNIT")
RESTARTS_LATER=$(systemctl --user show -p NRestarts --value "$UNIT" 2>/dev/null || echo 0)
[ "$PID_AFTER_RESTART" = "$PID_LATER" ] || die "$UNIT's MainPID changed inside 3s of the restart ($PID_AFTER_RESTART → $PID_LATER): it is cycling, not running"
[ "$RESTARTS_AFTER_RESTART" = "$RESTARTS_LATER" ] || die "$UNIT restarted $((RESTARTS_LATER - RESTARTS_AFTER_RESTART)) extra time(s) after this deploy's restart (NRestarts $RESTARTS_AFTER_RESTART → $RESTARTS_LATER)"
printf '%s restarted: MainPID %s, NRestarts %s\n' "$UNIT" "$PID_LATER" "$RESTARTS_LATER"

step "verify $UNIT"
node "$SCRIPT_DIR/verify-team-room.mjs" --unit-file "$UNIT_FILE" --data-dir "$X/data"
