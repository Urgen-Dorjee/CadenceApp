#!/bin/bash
# Start the packaged backend the way Cadence does and call its health check.
# Also runs the bundled FFmpeg and Deno. Usage: scripts/smoke-backend.sh <app resources folder>
set -uo pipefail
res=$(cd "$1" && pwd)  # absolute: the backend starts from its own folder
backend="$res/backend"
data=$(mktemp -d)
port=48765
fail=0

(cd "$backend" && CADENCE_TOKEN=check CADENCE_PACKAGED=1 PYTHONDONTWRITEBYTECODE=1 CADENCE_DATA_DIR="$data" \
  FFMPEG_PATH="$res/ffmpeg/ffmpeg" DENO_PATH="$res/deno/deno" FPCALC_PATH="$res/chromaprint/fpcalc" \
  "$backend/python/bin/python3" main.py --port $port >"$data/backend.log" 2>&1) &
pid=$!
health=""
for _ in $(seq 1 60); do
  health=$(curl -sf -H "x-cadence-token: check" "http://127.0.0.1:$port/api/health" 2>/dev/null) && break
  kill -0 $pid 2>/dev/null || break
  sleep 1
done
kill $pid 2>/dev/null || true
if [ -n "$health" ]; then
  echo "  backend: $health"
else
  echo "  BACKEND DIDN'T START:"; tail -30 "$data/backend.log"; fail=1
fi
"$res/ffmpeg/ffmpeg" -hide_banner -version | head -1 || { echo "  FFMPEG DOESN'T RUN"; fail=1; }
"$res/ffmpeg/ffprobe" -hide_banner -version | head -1 || { echo "  FFPROBE DOESN'T RUN"; fail=1; }
"$res/deno/deno" --version | head -1 || { echo "  DENO DOESN'T RUN"; fail=1; }
"$res/chromaprint/fpcalc" -version || { echo "  FPCALC DOESN'T RUN"; fail=1; }
rm -rf "$data"
exit $fail
