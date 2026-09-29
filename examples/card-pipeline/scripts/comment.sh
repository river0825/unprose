#!/usr/bin/env bash
# comment.sh <card> <text>
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
say "trello: comment on #$1: 🤖 $2"
printf '{"outcome":"done","data":{"comment":"%s"}}\n' "$2"
