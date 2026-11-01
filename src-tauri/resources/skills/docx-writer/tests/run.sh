#!/bin/sh
set -eu

SKILL_DIR="${SKILL_DIR:?SKILL_DIR is required}"
OUT="${OUTPUTS:?OUTPUTS is required}"
WORK=$(mktemp -d /tmp/docb-tests-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

docb() {
  python3 "$SKILL_DIR/bin/docb" "$@"
}

cat > "$WORK/spec.json" <<'JSON'
{
  "title": "Water report",
  "author": "Ada",
  "lang": "en",
  "blocks": [
    {"type": "title", "text": "Water report"},
    {"type": "heading", "level": 1, "text": "Summary"},
    {"type": "paragraph", "text": "Water is H2O."},
    {"type": "bullets", "items": ["Safe", "Clear"]},
    {"type": "table", "header": ["Item", "Value"], "rows": [["A", "1"], ["B", "2"]]},
    {"type": "quote", "text": "Yorùbá sample"},
    {"type": "page-break"}
  ]
}
JSON

docb validate "$WORK/spec.json" > "$WORK/validate.json"
grep -q '"ok": true' "$WORK/validate.json"

docb build "$WORK/spec.json" -o "$OUT/report.docx" > "$WORK/build.json"
test -f "$OUT/report.docx"
grep -q '"blocks": 7' "$WORK/build.json"

docb read "$OUT/report.docx" > "$WORK/read.json"
grep -q 'H2O' "$WORK/read.json"
grep -q 'Yorùbá' "$WORK/read.json"
grep -q '"A"' "$WORK/read.json"

docb check "$OUT/report.docx" > "$WORK/check.json"
grep -q '"tables": 1' "$WORK/check.json"
grep -q 'Water report' "$WORK/check.json"

cat > "$WORK/bad.json" <<'JSON'
{"blocks": [{"type": "table", "header": ["a", "b"], "rows": [["one"]]}]}
JSON
if docb validate "$WORK/bad.json" > "$WORK/bad-out.json" 2>/dev/null; then
  echo "bad spec should fail" >&2
  exit 1
fi
grep -q '"ok": false' "$WORK/bad-out.json"

echo "docx-writer golden tests passed"
