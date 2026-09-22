#!/usr/bin/env bash
# Mark the element a remark points at, and write the JPEG the review page uses.
#
# Usage: annotate.sh <still.png> <out.jpg> [x:y:w:h] [width]
#
#   x:y:w:h  the marker box in the still's own pixels (after the crop).
#            Leave it out for an unmarked still.
#   width    output width, default 1266 (half of a 2012-wide recording's
#            crop; about 100 KB a frame as JPEG).
#
# Homebrew's ffmpeg has no drawtext, so the marker is a box, and the page's
# caption says what it is on.
set -euo pipefail

src="${1:?still path}"
out="${2:?output jpeg}"
box="${3:-}"
width="${4:-1266}"

if [ -n "$box" ]; then
  vf="drawbox=${box}:color=#e0b341@0.95:t=4,scale=${width}:-1"
else
  vf="scale=${width}:-1"
fi

ffmpeg -v error -y -i "$src" -vf "$vf" -q:v 4 "$out"
echo "$out"
