#!/usr/bin/env bash
# reflect_to_board.sh <key> <event.type>
# Runs on `*.failed`: turn this workflow's failure/reflection signals into patterns and,
# when a canvas is reachable, ONE Backlog card per repeated pattern (idempotent).
# No AWD_CANVAS_URL, or the canvas is down → { "outcome": "skipped" } so goldens stay hermetic.
set -uo pipefail
key="${1:-?}"; failed="${2:-?}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF="$HERE/../workflow.yaml"
BOARD="${AWD_REFLECT_BOARD:-title:Card pipeline — Kanban}"
if [ -z "${AWD_CANVAS_URL:-}" ]; then
  echo "{\"outcome\":\"skipped\",\"data\":{\"reason\":\"AWD_CANVAS_URL not set\",\"signal\":\"$failed\"}}"; exit 0
fi
if ! curl -s -o /dev/null --max-time 2 "$AWD_CANVAS_URL/api/boards"; then
  echo "{\"outcome\":\"skipped\",\"data\":{\"reason\":\"canvas unreachable at $AWD_CANVAS_URL\",\"signal\":\"$failed\"}}"; exit 0
fi
# `awd` from the repo checkout when present, else whatever is on PATH.
AWD="${AWD_BIN:-}"
if [ -z "$AWD" ]; then
  if [ -f "$HERE/../../../packages/cli/bin/awd.js" ]; then AWD="node $HERE/../../../packages/cli/bin/awd.js"; else AWD="npx awd"; fi
fi
STORE_ARG=""; [ -n "${AWD_STORE_DIR:-}" ] && STORE_ARG="--store-dir $AWD_STORE_DIR"
out=$($AWD reflect "$WF" --since 30d --to-board "$BOARD" --canvas "$AWD_CANVAS_URL" --json $STORE_ARG 2>&1) || {
  echo "$out" >&2
  echo "{\"outcome\":\"skipped\",\"data\":{\"reason\":\"awd reflect failed\",\"signal\":\"$failed\"}}"; exit 0
}
python3 - "$out" "$failed" <<'PY'
import json, sys
raw, failed = sys.argv[1], sys.argv[2]
try:
    r = json.loads(raw)
except Exception:
    print(json.dumps({"outcome": "done", "data": {"signal": failed, "note": raw[-300:]}})); sys.exit(0)
print(json.dumps({"outcome": "done", "data": {"signal": failed, "created": r.get("created", []), "updated": r.get("updated", []), "board": r.get("url")}}))
PY
