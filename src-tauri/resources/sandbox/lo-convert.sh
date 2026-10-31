#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: lo-convert <input> <outdir> [pdf|pptx|docx|xlsx]" >&2
  exit 2
fi

input=$1
outdir=$2
format=${3:-pdf}

case "$format" in
  pdf|pptx|docx|xlsx) ;;
  *)
    echo "unsupported format: $format" >&2
    exit 2
    ;;
esac

if [ ! -f "$input" ]; then
  echo "input not found: $input" >&2
  exit 1
fi

mkdir -p "$outdir"
profile=$(mktemp -d /tmp/lo-profile-XXXXXX)
cleanup() {
  rm -rf "$profile"
}
trap cleanup EXIT INT TERM

exec 9>/tmp/lo-convert.lock
flock 9

limit=${LO_TIMEOUT:-60}
case "$limit" in
  ''|*[!0-9]*) limit=60 ;;
esac
if [ "$limit" -lt 1 ] || [ "$limit" -gt 3600 ]; then
  limit=60
fi

setsid soffice \
  --headless \
  --norestore \
  --nologo \
  --nodefault \
  --nolockcheck \
  "-env:UserInstallation=file://$profile" \
  --convert-to "$format" \
  --outdir "$outdir" \
  "$input" &
pid=$!

elapsed=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$elapsed" -ge "$limit" ]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    sleep 1
    kill -KILL -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    echo "lo-convert timed out after ${limit}s" >&2
    exit 124
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

wait "$pid"
