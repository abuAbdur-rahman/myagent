#!/bin/sh
set -eu

SKILL_DIR="${SKILL_DIR:?SKILL_DIR is required}"
OUT="${OUTPUTS:?OUTPUTS is required}"
WORK=$(mktemp -d /tmp/pdfwb-tests-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

pdfwb() {
  python3 "$SKILL_DIR/bin/pdfwb" "$@"
}

python3 - "$WORK" <<'PY'
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont

work = Path(sys.argv[1])

def simple(path, pages):
    c = canvas.Canvas(str(path), pagesize=letter)
    for index, text in enumerate(pages, start=1):
        c.drawString(72, 720, text)
        c.showPage()
    c.save()

simple(work / "a.pdf", ["Alpha page 1", "Alpha page 2"])
simple(work / "b.pdf", ["Beta page 1"])

doc = SimpleDocTemplate(str(work / "table.pdf"), pagesize=letter)
styles = getSampleStyleSheet()
rows = [["Name", "Score"], ["Ada", "10"], ["Linus", "9"]]
table = Table(rows)
table.setStyle(TableStyle([
    ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
]))
doc.build([Paragraph("Scores", styles["Title"]), table])

c = canvas.Canvas(str(work / "form.pdf"), pagesize=letter)
c.drawString(72, 720, "Form")
c.acroForm.textfield(name="name", x=72, y=650, width=220, height=24, value="")
c.showPage()
c.save()

image = Image.new("RGB", (900, 300), "white")
draw = ImageDraw.Draw(image)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
except OSError:
    font = ImageFont.load_default()
draw.text((40, 100), "HELLO OCR", fill="black", font=font)
image.save(work / "scan.png")
c = canvas.Canvas(str(work / "scan.pdf"), pagesize=(900, 300))
c.drawImage(str(work / "scan.png"), 0, 0, width=900, height=300)
c.showPage()
c.save()

(work / "report.md").write_text(
    "# Report\n\nWater is H2O.\n\n| Item | Value |\n|---|---|\n| A | 1 |\n| B | 2 |\n",
    encoding="utf-8",
)
PY

pdfwb inspect "$WORK/a.pdf" > "$WORK/inspect.json"
grep -q '"page_count": 2' "$WORK/inspect.json"
grep -q '"ok": true' "$WORK/inspect.json"

pdfwb text "$WORK/a.pdf" --pages 2 > "$WORK/text.json"
grep -q 'Alpha page 2' "$WORK/text.json"

pdfwb tables "$WORK/table.pdf" --format csv > "$WORK/tables.json"
grep -q '"tables": 1' "$WORK/tables.json"
test -f "$OUT"/table-p1-t1.csv

pdfwb merge "$WORK/a.pdf" "$WORK/b.pdf" --bookmarks > "$WORK/merge.json"
MERGE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/merge.json")
pdfwb verify "$MERGE" > "$WORK/merge-verify.json"
grep -q '"pages": 3' "$WORK/merge-verify.json"

pdfwb split "$WORK/a.pdf" --every 1 > "$WORK/split.json"
test "$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["files"]))' "$WORK/split.json")" -eq 2

pdfwb fill "$WORK/form.pdf" --values '{"name":"Ada"}' > "$WORK/fill.json"
FILLED=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/fill.json")
pdfwb fields "$FILLED" > "$WORK/fields.json"
grep -q 'Ada' "$WORK/fields.json"

pdfwb encrypt "$WORK/a.pdf" --user-password secret > "$WORK/encrypt.json"
ENCRYPTED=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/encrypt.json")
if pdfwb inspect "$ENCRYPTED" > "$WORK/encrypted.json" 2>/dev/null; then
  echo "inspect should fail without a password" >&2
  exit 1
fi
grep -q 'password_required' "$WORK/encrypted.json"
pdfwb inspect "$ENCRYPTED" --password secret > "$WORK/encrypted-ok.json"
grep -q '"encrypted": true' "$WORK/encrypted-ok.json"
pdfwb decrypt "$ENCRYPTED" --password secret > "$WORK/decrypt.json"
DECRYPTED=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/decrypt.json")
pdfwb verify "$DECRYPTED" > "$WORK/decrypt-verify.json"

PDFWB_STAMP=$(pdfwb stamp "$WORK/a.pdf" --text "CONFIDENTIAL" --pages 1)
STAMP=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["file"])' "$PDFWB_STAMP")
pdfwb verify "$STAMP" > "$WORK/stamp-verify.json"

pdfwb make "$WORK/report.md" > "$WORK/make.json"
MADE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/make.json")
pdfwb text "$MADE" > "$WORK/made-text.json"
grep -q 'H2O' "$WORK/made-text.json"

pdfwb ocr "$WORK/scan.pdf" > "$WORK/ocr.json"
OCR=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/ocr.json")
pdfwb text "$OCR" > "$WORK/ocr-text.json"
grep -qi 'HELLO' "$WORK/ocr-text.json"

pdfwb optimize "$WORK/a.pdf" > "$WORK/optimize.json"
OPT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/optimize.json")
pdfwb verify "$OPT" > "$WORK/optimize-verify.json"

pdfwb render "$WORK/a.pdf" --pages 1 --out "$OUT/render.png" > "$WORK/render.json"
test -f "$OUT/render.png"

echo "pdf-workbench golden tests passed"
