#!/usr/bin/env bash
# move_card.sh <card> <list> [--label NAME]   → { "outcome": "done", "data": { "list": ... } }
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
card="$1"; list="$2"; label="${4:-}"
say "trello: move #$card → '$list'${label:+ +label $label}"
printf '{"outcome":"done","data":{"card":"%s","list":"%s","label":"%s"}}\n' "$card" "$list" "$label"
