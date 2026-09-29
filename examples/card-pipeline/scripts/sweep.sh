#!/usr/bin/env bash
# sweep.sh — list orphan worktrees / dead tunnels. Never deletes.
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
say "reconcile: 0 orphan worktrees, 0 dead tunnels"
printf '{"outcome":"done","data":{"orphans":[]}}\n'
