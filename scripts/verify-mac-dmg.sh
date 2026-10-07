#!/bin/bash
# Check a built Cadence dmg the way a downloaded copy is checked:
# the app inside must have a valid signature and every program in it must run on `arch`.
# Usage: scripts/verify-mac-dmg.sh <dmg> <arm64|x64>
set -euo pipefail
dmg="$1"
want="$2"; [ "$want" = "x64" ] && want="x86_64"

mount=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
trap 'hdiutil detach "$mount" -force >/dev/null || true' EXIT
app="$mount/Cadence.app"

echo "Signature:"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv "$app" 2>&1 | grep -E "Signature|Identifier|Format"

echo "Architectures (want $want):"
wrong=0
count=0
while IFS= read -r -d '' f; do
  archs=$(lipo -archs "$f" 2>/dev/null) || continue
  count=$((count + 1))
  if [[ " $archs " != *" $want "* ]]; then
    echo "  WRONG: ${f#$mount/} is $archs"
    wrong=$((wrong + 1))
  fi
  # Every program must also carry its own valid signature.
  if ! codesign --verify --strict "$f" 2>/dev/null; then
    echo "  UNSIGNED: ${f#$mount/}"
    wrong=$((wrong + 1))
  fi
done < <(find "$app" -type f -print0)
echo "  checked $count programs and libraries"

echo "Gatekeeper (an unsigned-by-Apple app is expected to be rejected, but not as damaged):"
spctl --assess --type execute --verbose=4 "$app" 2>&1 || true

[ "$wrong" -eq 0 ] || { echo "::error::$wrong problem(s) in $dmg"; exit 1; }
echo "OK: $dmg"
