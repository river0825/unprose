#!/usr/bin/env bash
# board_move.sh <boardId> <cardId> <column-name>
# Push a kanban card into another column on the canvas — the workflow's way of
# "moving the Trello card". Uses the kanban endpoint when the server has it,
# otherwise re-parents the card with a plain ops POST.
set -euo pipefail
BOARD="${1:?boardId}"; CARD="${2:?cardId}"; COLUMN="${3:?column name}"
BASE="${AWD_CANVAS_URL:-http://localhost:4400}"

code=$(curl -s -o /tmp/awd_board_move.json -w '%{http_code}' -X POST "$BASE/api/boards/$BOARD/cards/$CARD/move" \
  -H 'content-type: application/json' -d "{\"column\":$(printf '%s' "$COLUMN" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"author\":\"agent\",\"note\":\"workflow moved card\"}")
if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  echo "{\"outcome\":\"done\",\"data\":{\"card\":\"$CARD\",\"column\":\"$COLUMN\",\"via\":\"cards\"}}"; exit 0
fi

# Fallback: find the column lane by name and re-parent the card at its bottom.
python3 - "$BASE" "$BOARD" "$CARD" "$COLUMN" <<'PY'
import json, sys, urllib.request
base, board_id, card, column = sys.argv[1:5]
board = json.load(urllib.request.urlopen(f"{base}/api/boards/{board_id}"))["board"]
items = board["items"]
lanes = [i for i in items.values() if i.get("type") == "lane" and i.get("text") == column]
if not lanes:
    print(json.dumps({"outcome": "failed", "data": {"reason": f"no column named {column}"}})); sys.exit(1)
lane = lanes[0]
siblings = [i for i in items.values() if i.get("parent") == lane["id"] and i["id"] != card]
y = max([i["y"] + i["h"] for i in siblings] + [lane["y"] + 44]) + 12
patch = {"parent": lane["id"], "x": lane["x"] + 20, "y": y, "order": len(siblings)}
body = json.dumps({"author": "agent", "ops": [{"kind": "update", "id": card, "patch": patch}], "note": f"workflow moved card to {column}"}).encode()
req = urllib.request.Request(f"{base}/api/boards/{board_id}/ops", data=body, headers={"content-type": "application/json"}, method="POST")
res = json.load(urllib.request.urlopen(req))
print(json.dumps({"outcome": "done", "data": {"card": card, "column": column, "via": "ops", "seq": res.get("seq")}}))
PY
