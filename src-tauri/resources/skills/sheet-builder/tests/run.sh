#!/bin/sh
set -eu

SKILL_DIR="${SKILL_DIR:?SKILL_DIR is required}"
OUT="${OUTPUTS:?OUTPUTS is required}"
WORK=$(mktemp -d /tmp/sheetb-tests-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

sheetb() {
  python3 "$SKILL_DIR/bin/sheetb" "$@"
}

cat > "$WORK/spec.json" <<'JSON'
{
  "title": "Scores",
  "sheets": [
    {
      "name": "Scores",
      "columns": ["Name", "Score", "Double"],
      "rows": [["Ada", 10, "=B2*2"], ["Linus", 9, "=B3*2"]],
      "widths": [18, 10, 10],
      "freeze": "A2"
    },
    {
      "name": "Notes",
      "columns": ["Note"],
      "rows": [["H2O is water"], ["Yorùbá"]]
    }
  ]
}
JSON

sheetb validate "$WORK/spec.json" > "$WORK/validate.json"
grep -q '"ok": true' "$WORK/validate.json"

sheetb build "$WORK/spec.json" -o "$OUT/book.xlsx" > "$WORK/build.json"
test -f "$OUT/book.xlsx"
grep -q '"sheets": 2' "$WORK/build.json"

sheetb read "$OUT/book.xlsx" > "$WORK/read.json"
grep -q '=B2\*2' "$WORK/read.json"
grep -q 'Yorùbá' "$WORK/read.json"

sheetb check "$OUT/book.xlsx" > "$WORK/check.json"
grep -q '"formulas": 2' "$WORK/check.json"

cat > "$WORK/bad.json" <<'JSON'
{"sheets": [{"name": "A", "columns": ["x", "y"], "rows": [["only one"]]}]}
JSON
if sheetb validate "$WORK/bad.json" > "$WORK/bad-out.json" 2>/dev/null; then
  echo "bad spec should fail" >&2
  exit 1
fi
grep -q '"ok": false' "$WORK/bad-out.json"

echo "sheet-builder golden tests passed"
