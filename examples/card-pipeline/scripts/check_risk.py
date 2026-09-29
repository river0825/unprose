#!/usr/bin/env python3
"""check_risk.py --card <id> → ok | missing

A hard-to-reverse card owes three things before it builds: a rollback section,
an integration test on the tripwire that was hit, and (for a destructive
migration) the migration split into its own card. Planning obligations — a
build worker cannot invent them mid-flight.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument("--card", required=True); a = ap.parse_args()
card = json.load(open(os.path.join(HERE, "..", "board.json")))["cards"].get(a.card, {})
missing = [k for k in ("rollback", "tripwireTest") if not card.get(k)]
if missing:
    print(f"🤖 build-guarded pause: missing {missing}", file=sys.stderr)
    print(json.dumps({"outcome": "missing", "data": {"missing": missing}}))
else:
    print(json.dumps({"outcome": "ok", "data": {"checked": ["rollback", "tripwireTest"]}}))
