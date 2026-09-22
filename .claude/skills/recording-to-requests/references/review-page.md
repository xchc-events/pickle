# The review page

A private Artifact the user reads top to bottom, then answers. Two have been
delivered this way; the second is https://claude.ai/artifact/RyMGuqheiJS5qSFYAvA3bY
(walkthrough 2, 23 Sep 2026), which is the pattern to copy.

## Order of sections

1. **Lede**: the route the user took through the app, and the counts
   (requests, stories, questions, left as is).
2. **Sticky jump bar**: Stories · Questions · one chip per screen · Left as is
   · Build order.
3. **User stories**: "As a <who>, I want <what>, so that <why>", grouped by
   who, each linking to the request IDs that deliver it.
4. **Questions**: one card each, the options in prose, a "Recommend: …" chip.
   End with a paragraph of the smaller calls you made and will build unless
   told otherwise.
5. **Requests by screen**, in recording order, each screen with a count and
   its time range in the recording.
6. **Left as they are**: what the user looked at and accepted, with the
   quote. Also where the transcript looped, so missing seconds are explained.
7. **Build order**: waves (no schema change → the record grows → new things),
   each listing its IDs.

## A request card

```html
<article class="req" id="p6">
  <header>
    <span class="num">P6</span><span class="ts">9:49</span>
    <h3>Drop the projection and the owner avatars from the right column</h3>
    <span class="flag">money display</span>
  </header>
  <blockquote>
    "We don't need the 'who owns it' over there, or 'projection'…"
    <span class="ts">9:49 – 10:28</span>
  </blockquote>
  <dl>
    <dt>Today</dt>
    <dd>The right column is headed "Door · projection · who owns it" and holds …</dd>
    <dt>Change</dt>
    <dd>Keep days to door under the head "Door"; remove <code>projection()</code> …</dd>
  </dl>
  <figure>
    <a href="stills/pipeline-right.jpg" target="_blank"
      ><img src="stills/pipeline-right.jpg" alt="…" loading="lazy"
    /></a>
    <figcaption><span class="mark"></span>9:52 · "Door · projection · who owns it"</figcaption>
  </figure>
</article>
```

IDs: a letter per screen (P pipeline, E event record, D design, T ticketing,
M promotion, X tech, R roster, H home, F finance, B bar, A admin) and a number
in recording order. Flags: `money` · `hours` · `permissions` · `sends email` ·
`reverses <doc>`; add `display` when a figure is only shown, not changed.

## Publishing

Write the page to the scratchpad, the JPEG stills beside it under `stills/`,
and publish with the Artifact tool: `file_path` the HTML, `root` the page's
directory, `files` a list of `{"path": "stills/<name>.jpg"}`. Stills as files
keep the page small and let a still open full size in a new tab. Icon
`clipboard`; description one sentence with the date and the counts.

## Style

Tokens on `:root` with a dark redefinition under both
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }`
and `:root[data-theme="dark"]`. Fonts: IBM Plex Sans (body), IBM Plex Mono
(IDs, times, labels), Newsreader italic (the user's words). The palette is a
cool off-white and ink with a violet accent that echoes the app, amber for
flags, green for "left as is". The CSS below is the second page's, and can be
pasted as is.

```css
:root {
  --paper: #f5f4f8;
  --card: #ffffff;
  --ink: #1d1b26;
  --muted: #625d73;
  --line: #dcd9e6;
  --accent: #5546c9;
  --accent-soft: #ebe9fa;
  --flag: #9a6a0c;
  --flag-soft: #fbf0d8;
  --good: #2f7a4d;
  --good-soft: #e2f1e7;
  --quote: #2a2637;
  --shadow: 0 1px 2px rgba(29, 27, 38, 0.06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --paper: #14121b;
    --card: #1d1a27;
    --ink: #ebe9f2;
    --muted: #a29eb5;
    --line: #2e2a3c;
    --accent: #a198ff;
    --accent-soft: #272348;
    --flag: #e0b341;
    --flag-soft: #33290f;
    --good: #6fcf97;
    --good-soft: #12301d;
    --quote: #d8d4e6;
    --shadow: none;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --paper: #14121b;
  --card: #1d1a27;
  --ink: #ebe9f2;
  --muted: #a29eb5;
  --line: #2e2a3c;
  --accent: #a198ff;
  --accent-soft: #272348;
  --flag: #e0b341;
  --flag-soft: #33290f;
  --good: #6fcf97;
  --good-soft: #12301d;
  --quote: #d8d4e6;
  --shadow: none;
}
body {
  background: var(--paper);
  color: var(--ink);
  font-family: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  padding-block: 32px 96px;
  padding-inline: 16px;
}
.wrap {
  max-width: 860px;
  margin: 0 auto;
}
h1 {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
  margin: 0;
  text-wrap: balance;
}
h2 {
  font-size: 21px;
  font-weight: 600;
  margin-block: 56px 16px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}
h2 small {
  display: block;
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
  margin-top: 4px;
}
h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}
nav.jump {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 2;
  background: var(--paper);
  padding-block: 12px;
  margin-top: 24px;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
nav.jump a {
  text-decoration: none;
  font-size: 13px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  background: var(--card);
}
.story {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 10px;
}
.q {
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  margin-bottom: 12px;
}
.q .rec {
  display: inline-block;
  margin-top: 8px;
  padding: 3px 9px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
}
.req {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 20px 16px;
  margin-bottom: 18px;
  box-shadow: var(--shadow);
}
.req header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
  margin-bottom: 8px;
}
.req .num {
  font-family: 'IBM Plex Mono', Menlo, monospace;
  font-weight: 500;
  font-size: 13px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 8px;
  border-radius: 4px;
}
.req .ts {
  font-family: 'IBM Plex Mono', Menlo, monospace;
  font-size: 12.5px;
  color: var(--muted);
}
.req .flag {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--flag-soft);
  color: var(--flag);
}
.req h3 {
  flex-basis: 100%;
}
blockquote {
  margin: 8px 0 14px;
  padding: 0 0 0 14px;
  border-left: 3px solid var(--line);
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  font-size: 17.5px;
  line-height: 1.45;
  color: var(--quote);
  max-width: 62ch;
}
blockquote .ts {
  display: block;
  font-family: 'IBM Plex Mono', Menlo, monospace;
  font-style: normal;
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
dl {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 6px 14px;
  margin: 0 0 6px;
}
dt {
  font-family: 'IBM Plex Mono', Menlo, monospace;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding-top: 3px;
}
dd {
  margin: 0;
  max-width: 70ch;
}
dd code {
  font-family: 'IBM Plex Mono', Menlo, monospace;
  font-size: 12.5px;
  background: var(--accent-soft);
  padding: 1px 5px;
  border-radius: 3px;
}
figure {
  margin: 14px 0 0;
}
figure img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
}
figcaption {
  font-size: 12.5px;
  color: var(--muted);
  margin-top: 6px;
}
figcaption .mark {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid #e0b341;
  border-radius: 2px;
  vertical-align: -1px;
  margin-right: 4px;
}
@media (max-width: 520px) {
  .story,
  dl {
    grid-template-columns: 1fr;
  }
}
```
