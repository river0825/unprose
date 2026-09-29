# Shared helpers for the fake scripts. Real scripts would call Trello / gh here;
# these just narrate on stderr and answer on stdout.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOARD="$HERE/../board.json"
say() { echo "  · $*" >&2; }
card_field() { python3 -c "import json,sys; c=json.load(open('$BOARD'))['cards'].get('$1',{}); v=c.get('$2'); print('' if v is None else v)"; }
