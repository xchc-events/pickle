#!/usr/bin/env bash
# Transcribe a narrated screen recording with whisper-cli.
#
# Usage: transcribe.sh <recording> <outdir> [vocabulary prompt]
#
# Writes <outdir>/audio.wav, transcript.json, transcript.srt and whisper.log.
# Run it with the Bash sandbox lifted and in the background: whisper's Metal
# backend cannot allocate buffers inside the sandbox, and a 24-minute
# recording takes about four minutes.
#
# The vocabulary prompt is a comma-separated list of the product's own words
# (modules, people, suppliers, jargon). Whisper spells a word right once it
# has seen it in the prompt; without one, "the Crock" came out as "the croc".
set -euo pipefail

rec="${1:?recording path}"
out="${2:?output directory}"
vocab="${3:-}"
model="${WHISPER_MODEL:-$HOME/Models/whisper/ggml-large-v3-turbo-q5_0.bin}"

if [ ! -f "$model" ]; then
  echo "whisper model not found at $model — set WHISPER_MODEL or download" >&2
  echo "ggml-large-v3-turbo-q5_0.bin from huggingface.co/ggerganov/whisper.cpp" >&2
  exit 1
fi

mkdir -p "$out"
ffmpeg -v error -y -i "$rec" -vn -ar 16000 -ac 1 -c:a pcm_s16le "$out/audio.wav"

if [ -n "$vocab" ]; then
  whisper-cli -m "$model" -l en -ojf -osrt -of "$out/transcript" --prompt "$vocab" \
    "$out/audio.wav" > "$out/whisper.log" 2>&1
else
  whisper-cli -m "$model" -l en -ojf -osrt -of "$out/transcript" \
    "$out/audio.wav" > "$out/whisper.log" 2>&1
fi

echo "transcript: $out/transcript.json ($(grep -c '^\[' "$out/whisper.log") segments)"
