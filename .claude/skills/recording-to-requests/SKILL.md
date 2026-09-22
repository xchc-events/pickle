---
name: recording-to-requests
description: Turn a narrated screen recording (a .mov or .mp4 of somebody walking through the app while talking) into user stories, change requests, feature requests and bug-fix requests that Claude Code agents can implement. Use this whenever the user hands over a screen recording, a walkthrough video, a "me talking over the app" file, or says to pull the feedback, stories, requests or fixes out of a recording, even when they only attach the file and say "here's my feedback" or "make these changes". Covers transcription with whisper-cli, transcript-driven stills, matching every remark to the code as it is today, the private review page with annotated stills, the clarifying questions, and the hand-off to a build fleet.
---

# Recording to requests

The user explains product changes by recording their screen with the
microphone on and handing over the file. You cannot hear it or watch it, so
the job is to turn it into something both of you can point at: a private
review page listing every request in their own words, with the time in the
recording, what the code does today, the change, and an annotated still. Only
then do the questions get asked and the building start.

The deliverable of the first pass is **the page and the questions, not code**.
The user reviews the list, answers the questions, and says "make those
changes". Building before that has twice produced work that was thrown away.

## What you produce

1. A private review page (Artifact) with, in this order: user stories,
   questions with a recommendation each, change requests grouped by screen in
   recording order, things the user looked at and left alone, and a build
   order in waves. `references/review-page.md` has the anatomy and the CSS.
2. A chat message: the link, the counts, the three or four biggest items, and
   the questions.
3. The questions themselves through `AskUserQuestion`, so the answers arrive
   before anything is built.

## Before you start

- Find the file with a glob, never a typed path: macOS puts a narrow no-break
  space (U+202F) before "AM"/"PM" in screen-recording names. A file dragged
  from the floating thumbnail lives in `/var/folders/.../TemporaryItems/`,
  which no process here can read; ask the user to move it to their save
  folder (`open -R <file>` reveals it in Finder).
- `ffprobe` the duration and frame size. Transcription takes about 2–3% of
  the recording's length; a 24-minute recording is about four minutes.
- In a repo with parallel sessions, `git fetch` and survey branches and
  worktrees before reading code, so "what the code does today" is today's
  code. Check plan usage if a fleet will follow (see the fleet memory).

## Step 1 · Transcribe, in the background

```bash
bash scripts/transcribe.sh "<recording>" <outdir> "<project vocabulary>"
```

Run it with the Bash sandbox lifted (`dangerouslyDisableSandbox`), in the
background: whisper's Metal backend fails with `failed to allocate buffer`
inside the sandbox. The vocabulary prompt is a comma-separated list of the
product's own words (module names, people, suppliers, jargon); whisper spells
them right when it has seen them. The model is
`~/Models/whisper/ggml-large-v3-turbo-q5_0.bin` unless `WHISPER_MODEL` says
otherwise. The stub model Homebrew ships transcribes nothing.

While it runs, map the code: routes, the `lib` files behind each screen, the
schema's models, and the headings of the design docs. You will match every
remark to a file in step 4, and having the map ready makes that a lookup.

## Step 2 · Read the transcript

```bash
python3 scripts/segments.py <outdir>/transcript.json            # one line per segment, [mm:ss]
python3 scripts/segments.py <outdir>/transcript.json --pointers # candidate still times
```

`segments.py` collapses whisper's loops: over silence it repeats a line
("I don't know if I can get rid of those cards" fourteen times). Nothing
in a loop is something the user said; say so on the page so they do not
wonder where those seconds went.

Read the whole transcript before anything else and mark, by hand:

- **Screen changes**: "coming back here", "Tech production, okay", a module
  name said aloud. Each is a still.
- **Pointer words**: "this", "here", "these four", "that button". The
  `--pointers` list is the start; the still tells you what "this" is.
- **Verdicts with no request**: "oh, that makes sense", "this looks great",
  "we can leave this one". They go under "Left as they are", which shows the
  user the whole recording was heard.
- **Questions the user asks themselves**: "so how do I change this?",
  "why is it saying six to chase?" Each one is a request or a bug.

## Step 3 · Stills, from the transcript, viewed as sheets

```bash
bash scripts/stills.sh "<recording>" <outdir>/stills <crop> 92 110 130 ...
```

The scripts live beside this file; run them with `bash` and `python3` as
shown, since a checkout does not always keep the executable bit.

Pass one time in seconds per moment marked in step 2, plus the midpoint of
any long remark. Scene detection alone misses the moments that matter (a
click that lasts under a second) and finds ones that do not.

`<crop>` cuts the browser chrome so the user's other tabs and bookmarks never
appear on the page: for a 2012×1062 Safari recording it is
`1898:861:57:126`; measure once per recording with a probe still. The script
writes full-size stills and 2×2 contact sheets at half width. Read the sheets
(one image shows four moments), and read a single still only where a sheet
is not enough to tell what "this" points at. Forty-five stills as twelve
sheets cost less than a third of viewing them singly and were enough for a
24-minute recording.

The click ring and any text the user highlights are the most reliable
pointers; the cursor position is the next.

## Step 4 · Match every remark to the code

For each remark, find the page component, the `lib` function and the schema
field behind it, and write "today" from what the code does, not from memory
or the docs. Name the file. Then write the change in one or two sentences as
the user would recognise it, without adding scope they did not ask for; if
the natural implementation goes further, say so as a question.

Flag every request that touches **money, hours or permissions**, or that
**sends email**, since those are written test-first in this project. Flag any
request that reverses a decision recorded in the design docs, and say which.

Where a remark has two readings that lead to different work, it becomes a
question with a recommendation, not a guess. Where it has one obvious reading
and a small choice inside it (a label's wording, a section's position), make
the call and list it under "smaller calls I have made".

## Step 5 · Write the page

IDs are a letter per screen and a number in recording order (P1, E3, D6),
so the chat, the questions and the build waves can refer to them. Each card:

- **Title**: the change as a verb phrase.
- **Quote**: the user's words, verbatim minus the ums, with the time range.
- **Today**: what the code does, with the file.
- **Change**: what will be true afterwards.
- **Flags**: money · hours · permissions · sends email · reverses a decision.
- **Still**: the annotated frame, captioned with its time and what the marker
  is on. `scripts/annotate.sh` draws the marker (`x:y:w:h` in the cropped
  frame's pixels) and writes the JPEG; publish the JPEGs as the artifact's
  files, not inline data URIs.

User stories come first on the page, grouped by who wants them, each linking
to the requests that deliver it. The build order groups requests into waves:
wording and layout with no schema change, then the record growing, then new
things. Count everything in the lede so the user knows the page is complete.

## Step 6 · Publish, summarise, ask

Publish the page with the stills as files. In chat: the link, the counts,
the biggest items in a few bullets, and that the questions follow. Then ask
the questions with `AskUserQuestion`, up to four a call, recommended option
first, and stop. Do not start building on the unambiguous items while
waiting: the user reads the list as a whole and may reorder or drop things.

## Step 7 · Build, once told to

Follow the project's fleet rules (the `fleet-builds-on-the-pro-plan` memory
in this project): worktrees made from `origin/main`, three cheaper builders
at a time in wave order, each with a short reading list and told to write
files early, tests before implementation for anything flagged, review the
diffs yourself, PRs with auto-merge. After each wave, send the user a
captioned render of the result; a render caught a layout regression that
tests could not.

## Calibration

| Recording                  | Length | Requests          | Stills read    | Transcribe |
| -------------------------- | ------ | ----------------- | -------------- | ---------- |
| Walkthrough 1, 22 Sep 2026 | 4:30   | 15                | 12             | 35 s       |
| Walkthrough 2, 23 Sep 2026 | 23:41  | 44 + 4 left as is | 27 (12 sheets) | 4 min      |

Read `references/traps.md` before the first run on a new machine or a new
recording setup; every entry there cost time once.
