---
name: port-prototype-module
description: Port one module of the PicklePicklePickle design prototype into the Next.js codebase — Pipeline, Ticketing, Roster, Finance, and so on. Use whenever the task is to build, rebuild or extend a screen that already exists in docs/design-handoff/design/Pickle Prototype.dc.html. Not for greenfield screens that have no prototype counterpart.
---

# Porting a module from the prototype

The prototype is a specification written in HTML. It is **read and reproduced**,
never lifted — it targets a bespoke streaming-template runtime that is not part
of this codebase.

## Before writing anything

1. Read the module's section in `docs/design-handoff/README.md`. It states which
   parts are specification-grade and which are guidance.
2. Find the module in `docs/design-handoff/design/Pickle Prototype.dc.html`.
   Constants (`CFG`, `COV`, `STAGES`, `MODULES`, `ROLE_LABEL`, `DEFAULT_PERMS`,
   `USERS`, `PEOPLE`, `PRESETS`, `ASSET_SET`, `PLATFORMS`) sit in the script
   block near line 3040.
3. Open the prototype in a browser and sign in as **Sione Latu (Super admin)**
   to see the whole thing, or as **Awhina Reid** / **Devon Marsh** for the
   scoped external-promoter view.

## What is specification-grade — reproduce exactly

- **Information architecture.** Which screen holds what, and the order.
- **Finance mathematics.** Already ported in `src/lib/finance.ts`. If a module
  needs a figure, import it from there. Never recompute money inline.
- **Stage-gate logic.** An event cannot advance while a gate fails. Gates are
  named conditions with a pass/fail state, a reason, and a deep link to the
  screen that fixes it.
- **Copy.** The wording is deliberate. Toasts explain the _consequence_, not the
  action taken.

Pixel spacing is guidance. **Density is not** — this is intentionally a dense
tool. Do not add breathing room.

## What must be real, not prototyped

- **Permissions** are enforced server-side. A module missing from a role's
  sidebar must also be unreachable by URL and by direct server action. Hiding UI
  is a convenience, never the control.
- **External promoters** see only events matching their org, and only Pipeline
  and Sign-offs. Venue-side actions are _absent_, not disabled.
- **Every mutation writes to the activity feed.** That table is append-only; it
  is the audit trail.
- **Persistence** is Postgres via `src/lib/db.ts`. The prototype's
  `localStorage` under `p3-prototype-v1` is not a model to copy.

## Styling

Take every visual value from `src/styles/tokens.css`. The prototype writes
tokens inline (`var(--color-neutral-500)`, `13px`) only because it has no
stylesheet layer. If you find yourself typing a hex code, stop — the token
exists.

Repeating patterns worth extracting as components before duplicating them:
section heading with the fading rule, metric strip, row list, chip filters,
avatar.

## Finish

`npm run check` must pass. A module that changes money, hours or permissions
needs a test that fails without the change.
