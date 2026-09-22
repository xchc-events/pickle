#!/usr/bin/env python3
"""Read a whisper-cli JSON transcript as one line per segment.

Usage:
  segments.py transcript.json               # [mm:ss] text, loops collapsed
  segments.py transcript.json --pointers    # "<seconds>\\t<text>" for stills
  segments.py transcript.json --from 744    # only segments from that second

Over silence whisper repeats its last line, sometimes a dozen times with the
timestamps creeping forward. Those lines are not something the speaker said,
so consecutive duplicates are collapsed and counted on stderr.

--pointers lists the midpoint of every segment that contains a pointer word
("this", "these", "here", "that one"), at least --min-gap seconds apart, as
the starting list of stills. Screen changes and long remarks are added by
hand after reading the transcript.
"""

import argparse
import json
import re
import sys

POINTERS = re.compile(r"\b(this|these|here|that one|those|over there|right here)\b", re.I)


def load(path):
    with open(path, encoding="utf-8") as fh:
        segments = json.load(fh)["transcription"]
    out, prev, loops = [], None, 0
    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue
        if text == prev:
            loops += 1
            continue
        prev = text
        start = seg["offsets"]["from"] / 1000
        end = seg["offsets"]["to"] / 1000
        out.append((start, end, text))
    return out, loops


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json")
    ap.add_argument("--pointers", action="store_true", help="print still timestamps instead of the transcript")
    ap.add_argument("--min-gap", type=float, default=15, help="seconds between suggested stills (default 15)")
    ap.add_argument("--from", dest="from_s", type=float, default=0, help="start at this second")
    args = ap.parse_args()

    segments, loops = load(args.json)
    segments = [s for s in segments if s[1] >= args.from_s]

    if args.pointers:
        last = -1e9
        for start, end, text in segments:
            mid = (start + end) / 2
            if POINTERS.search(text) and mid - last >= args.min_gap:
                print(f"{int(mid)}\t{text}")
                last = mid
    else:
        for start, _end, text in segments:
            minutes, seconds = divmod(int(start), 60)
            print(f"[{minutes:02d}:{seconds:02d}] {text}")

    if loops:
        print(f"({loops} repeated lines collapsed: whisper looping over silence)", file=sys.stderr)


if __name__ == "__main__":
    main()
