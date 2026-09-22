# Traps, each of which cost time once

## Finding and reading the file

- macOS names recordings `Screen Recording 2026-09-23 at 8.25.57 AM.mov` with a
  narrow no-break space (U+202F) before AM. A typed space never matches; use
  a glob: `ls "$dir"/Screen*2026-09-23*8.25.57*.mov`.
- A file dragged from the floating thumbnail is a path under
  `/var/folders/.../TemporaryItems/NSIRD_screencaptureui_*`, which macOS
  refuses to every process here, sandbox or not. `open -R "<file>"` reveals
  it in Finder for the user to drag into their save folder.
- `~/Documents/Screenshots & Screen Recordings` reads fine from the sandbox;
  the audio and stills go to the scratchpad, never next to the recording.

## Transcribing

- whisper-cli needs the Bash sandbox lifted or Metal fails with
  `failed to allocate buffer`. Run it in the background; a 24-minute file
  takes about four minutes with the large-v3-turbo q5_0 model.
- `/opt/homebrew/share/whisper-cpp/for-tests-ggml-tiny.bin` is a stub that
  transcribes nothing. The real model is 574 MB from
  huggingface.co/ggerganov/whisper.cpp, and the CDN stalls mid-download:
  `curl -C - --speed-limit 100000 --speed-time 15` in a retry loop resumes it.
- Over silence whisper repeats its last line with creeping timestamps. Twice
  in 24 minutes: fourteen copies of one line at 12:10, and a three-line loop
  at 15:44. `segments.py` collapses them; say on the page that nothing came
  from those stretches.
- Without a vocabulary prompt product words come out phonetically
  ("the croc" for "the Crock"). Pass the module names, people and suppliers.

## Stills

- Scene detection found five of the moments that mattered in a 4:30
  recording and missed a click under a second long. Drive stills from the
  transcript instead.
- Crop below the browser's tab bar (`crop=1898:861:57:126` for 2012×1062) so
  the user's other tabs are never on a page that might be shared.
- Read 2×2 contact sheets first. Text at half width is legible enough to
  tell which screen and section a remark is on; read a single still only to
  resolve what a pointer word means.
- Homebrew's ffmpeg has no `drawtext`; annotate with `drawbox` and put the
  words in the caption.
- Headless Chrome `--screenshot` renders blank with a `#fragment` URL and
  hangs on a Google Fonts `<link>`, if you render the built result afterwards.

## Writing the page

- His words verbatim minus the ums; a paraphrase in a quote block reads as
  putting words in his mouth.
- "Today" comes from the code, with the file named. The design handoff is
  often older than the code and has been overruled in places; a request that
  reverses a documented decision gets a flag, not silence.
- Count what you found in the lede. A list without a count leaves the reader
  wondering whether the second half of the recording was heard.
- The page is private until shared; say so when the reader is not the owner.
- The user cannot decide on-screen behaviour from prose. Where a question is
  about how something should look, send a render before asking.

## After the build

- Send a captioned composite render of each wave's result. A render of the
  first walkthrough's pay-rate change caught a layout regression the tests
  did not.
