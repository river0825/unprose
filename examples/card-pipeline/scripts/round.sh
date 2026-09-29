#!/usr/bin/env bash
# round.sh — counts fix rounds from the run's own vars (stdin carries { vars, ... }); 3 rounds then escalate.
set -euo pipefail
python3 -c '
import json, sys
inp = json.load(sys.stdin)
prev = (inp.get("vars") or {}).get("fix-round") or {}
rounds = int(prev.get("rounds") or 0) + 1
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 3
print(json.dumps({"outcome": "again" if rounds <= limit else "escalate", "data": {"rounds": rounds, "limit": limit}}))
' "${1:-3}"
