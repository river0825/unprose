#!/usr/bin/env bash
# merge.sh <card> --pr N
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
say "gh pr merge $3 --merge --delete-branch"
say "openspec archive; trello: move #$1 → 'Ready for Staging'; teardown worktree/tunnel/server"
printf '{"outcome":"done","data":{"merged":true,"pr":%s}}\n' "$3"
