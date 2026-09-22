#!/usr/bin/env bash
# Extract stills from a recording at given seconds, and tile them 2x2.
#
# Usage: stills.sh <recording> <outdir> <crop|none> <seconds>...
#
#   crop   ffmpeg crop as w:h:x:y, cutting the browser chrome so the user's
#          other tabs never show. 1898:861:57:126 fits a 2012x1062 Safari
#          recording; measure a new setup once with a probe still.
#
# Writes still_NN_tSSS.png (full size, cropped) for annotating later, and
# sheet_NN.png contact sheets of four stills at half width. Read the sheets
# first: one image shows four moments at a quarter of the cost.
set -euo pipefail

rec="${1:?recording path}"
out="${2:?output directory}"
crop="${3:?crop w:h:x:y or none}"
shift 3
[ "$#" -gt 0 ] || { echo "give at least one time in seconds" >&2; exit 1; }

mkdir -p "$out"
vf="null"
[ "$crop" != "none" ] && vf="crop=$crop"

i=0
for t in "$@"; do
  i=$((i + 1))
  n=$(printf "%02d" "$i")
  ffmpeg -v error -y -ss "$t" -i "$rec" -frames:v 1 -vf "$vf" "$out/still_${n}_t${t}.png"
  ln -sf "still_${n}_t${t}.png" "$out/seq_${n}.png"
done

width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$out/seq_01.png")
half=$((width / 2))

g=1
while [ "$g" -le "$i" ]; do
  ffmpeg -v error -y -start_number "$g" -i "$out/seq_%02d.png" -frames:v 1 \
    -vf "scale=${half}:-1,tile=2x2" "$out/sheet_$(printf '%02d' "$g").png"
  g=$((g + 4))
done

echo "$i stills, $(ls "$out"/sheet_*.png | wc -l | tr -d ' ') sheets in $out"
echo "sheet_NN holds stills NN..NN+3 left to right, top to bottom"
