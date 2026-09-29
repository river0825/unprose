#!/usr/bin/env python3
"""qualify.py --card <id> → {"outcome": "pick"|"skip", "data": {...}}

The deterministic part of "is this card buildable": hands-off labels, the
ReadyForAgent label, CardSize, and the Risk class. Reads board.json here;
the real one reads Trello (see example/card-pipeline-coordinator/scripts/qualify.py).
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HANDS_OFF = {"ST:HumanOwned", "ST:Blocked"}
HARD_TO_REVERSE = {"Highest", "High", "Not sure"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--card", required=True)
    a = ap.parse_args()
    board = json.load(open(os.path.join(HERE, "..", "board.json")))
    card = board["cards"].get(a.card)
    if card is None:
        return out("skip", reason="unknown-card")
    labels = set(card.get("labels", []))
    if labels & HANDS_OFF:
        return out("skip", reason="hands-off")
    if "ST:ReadyForAgent" not in labels:
        return out("skip", reason="no-rfa")
    size = card.get("size")
    if not size:
        return out("skip", reason="unsized")
    risk = card.get("risk")
    if risk is None:
        return out("skip", reason="risk-unset")
    risk_class = "hard-to-reverse" if risk in HARD_TO_REVERSE else "reversible"
    out("pick", size=size, risk=risk, riskClass=risk_class, assumed=(risk == "Not sure"), name=card.get("name"))


def out(outcome, **data):
    print(f"qualify: {outcome} {data}", file=sys.stderr)
    print(json.dumps({"outcome": outcome, "data": data}))


if __name__ == "__main__":
    main()
