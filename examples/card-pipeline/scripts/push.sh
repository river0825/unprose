#!/usr/bin/env bash
# push.sh <card> --size S   → { "outcome": "done", "data": { "pr": 123, "branch": "..." } }
# The real one adopts planning's branch + draft PR, pushes the builder's commits, and
# runs gate.py (real implementation file changed · clean base · fresh base).
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
card="$1"; size="${3:-?}"
say "trello: move #$card → 'In Progress'"
say "git: fetch origin main; checkout <issue>-$card; push builder commits (size $size, attempt $AWD_ATTEMPT)"
if [ "$card" = "c-flaky" ] && [ "$AWD_ATTEMPT" = "1" ]; then
  echo "gate.py: GATE-FAIL (c) 1 commit already on origin/main (stale base)" >&2
  exit 1
fi
say "gate.py: PASS — real implementation, clean base"
say "trello: move #$card → 'AI Agent Review'"
printf '{"outcome":"done","data":{"pr":%d,"branch":"42-%s","size":"%s","preview":"https://%s.preview.example.test"}}\n' $((RANDOM % 900 + 100)) "$card" "$size" "$card"
