#!/bin/sh
set -eu

SKILL_DIR="${SKILL_DIR:?SKILL_DIR is required}"
OUT="${OUTPUTS:?OUTPUTS is required}"
WORK=$(mktemp -d /tmp/deckb-tests-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

deckb() {
  python3 "$SKILL_DIR/bin/deckb" "$@"
}

python3 - "$WORK/map.png" <<'PY'
import sys
from PIL import Image, ImageDraw
image = Image.new("RGB", (640, 360), "#f7f5f1")
draw = ImageDraw.Draw(image)
draw.rectangle((40, 40, 600, 320), outline="#c45a32", width=8)
draw.text((80, 160), "MAP", fill="#1e2328")
image.save(sys.argv[1])
PY

cat > "$WORK/spec.json" <<JSON
{
  "meta": {"title": "Q4 review", "author": "Ada", "lang": "en", "max_slides": 8},
  "theme": "clean-light",
  "slides": [
    {"layout": "title", "title": "Q4 review", "subtitle": "Ada", "notes": "Welcome"},
    {"layout": "bullets", "title": "Highlights", "bullets": ["Revenue up", "Costs flat"]},
    {"layout": "table", "title": "Numbers", "header": ["Item", "Value"], "rows": [["A", "1"], ["B", "2"]]},
    {"layout": "chart", "title": "Trend", "categories": ["Q1", "Q2"], "series": [{"name": "Revenue", "values": [1, 2]}]},
    {"layout": "image", "title": "Map", "image": "$WORK/map.png", "alt": "Route map"},
    {"layout": "closing", "title": "Thank you"}
  ]
}
JSON

deckb validate "$WORK/spec.json" > "$WORK/validate.json"
grep -q '"ok": true' "$WORK/validate.json"

deckb build "$WORK/spec.json" -o "$OUT/deck.pptx" > "$WORK/build.json"
test -f "$OUT/deck.pptx"
grep -q '"slides": 6' "$WORK/build.json"

deckb read "$OUT/deck.pptx" > "$WORK/read.json"
grep -q 'Welcome' "$WORK/read.json"
grep -q 'Revenue up' "$WORK/read.json"
grep -q '"A"' "$WORK/read.json"

deckb check "$OUT/deck.pptx" > "$WORK/check.json"
grep -q '"slides": 6' "$WORK/check.json"
grep -q '"charts": 1' "$WORK/check.json"

cat > "$WORK/bad.json" <<'JSON'
{"slides": [{"layout": "image", "title": "Map", "image": "missing.png"}]}
JSON
if deckb validate "$WORK/bad.json" > "$WORK/bad-out.json" 2>/dev/null; then
  echo "bad spec should fail" >&2
  exit 1
fi
grep -q '"ok": false' "$WORK/bad-out.json"

echo "deck-builder golden tests passed"
