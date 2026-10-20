# session-board

A band above the prompt in Claude Code, in the terminal and the desktop app. Two lines: the model and its limits and spend, and
your ai-sdlc progress, from real session events and the files in your project.

It began as a fork of [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT); the pure
reducers and the style of the first line come from it. See `NOTICE`.

> Claude Code mods are an early-access feature and the API may change. Needs Claude Code 2.1.296 or later.

## Install

Inside Claude Code:

```
/plugin marketplace add tammai/session-board
/plugin install session-board@session-board
/reload-plugins
/session-board
```

To try it for one session from a clone: `claude --plugin-dir ./session-board`. In the desktop app, which has no `/plugin`,
use the + next to the prompt box, then Plugins, then Add marketplace.

## What it shows

An orange-bordered band, two lines:

```
○ idle · Opus 5.5 high · ctx 42% · 5h 85% 43m · 7d 31% 2d4h · $1.23/$16.03
AI-SDLC ✔─✔─✔─◉─○─○─○─○  now Build · next Verify · done 8/9 · 2026-10-20-playable-loop · tier M
```

**Line 1** is `● working` or `○ idle`, the model with its effort, `ctx`, `5h` and `7d` as percents (green to 50%, orange above, red
from 80%) with the time to each reset, and the spend as `$session/$project`.

**Line 2** appears only in a project that has `.sdlc/` or `docs/sdlc/`:
- an eight-step progress line (Intent, Spec, Plan, Build, Verify, Review, Ship, Knowledge): marks joined by lines, lit up to
  the current step; a skipped step is `⊖`;
- the step now (orange) and the step next (blue), with the build's progress after them (`done 8/9`, in green: steps that
  passed out of all of them; not shown for a build of one step);
- the change and its tier. A closed change reads `closed` in place of now and next. What does not fit is cut from the right.

**On the desktop app** the band is one line of AI-SDLC and nothing else, and the host frames it and draws its close control (`×`),
as it does for its other panels:

```
AI-SDLC · Build · Tier M · 2026-10-20-playable-loop         ✔─✔─✔─◉─○─○─○─○  8/9   ×
```

The title, the step now (in orange), the tier and the change, each after a small dot (cut at the edge when the window is narrow), the pipeline as one small drawing with no labels (a
ticked disc for a step done, a ringed dot with a halo for the step now, an open ring for a step to come, a dashed ring for one
skipped), the build's count (steps that passed out of all of them, the passed number in green; not shown for a build of one step)
and the close control. It is all one size of type, in the host's font. A project with no ai-sdlc files has no band there. The
editor and the phones get the two-row card (the limits as bars, the spend, then the AI-SDLC row) in an orange border.

## Commands

`/session-board [open|close]` shows or hides the band; on the desktop the close control does the same. The `openOnStart` option sets
whether it shows when a session starts.

## When something is unavailable

Any value that cannot be read shows `N/A` and the band keeps drawing: no rate-limit data, a missing cost ledger, a malformed
change file. A project with no ai-sdlc files has no second line.

## What it reads, and what it never does

It reads the session's own events; `.sdlc/*.json`; the active change's `docs/sdlc/<change>/*.md` front matter;
`knowledges/log.md`; and, once per project, `~/.claude/statusline-cost/`. The project's spend is the board's own ledger in the
host's store: one record per session, counted as `base + last`, a restarted counter keeping what came before. The first time
it sees a project it copies those statusline records once; after that it never reads them again.

It never writes to your project, runs no program, makes no network request and calls no model. It draws ids, stages and counts,
never transcript or intent text, and strips control characters from everything it reads from your files.

## Options

Set in `/config` or under `pluginConfigs["session-board"].options` in `settings.json`: `palette` (`theme`, `pastel`) and
`openOnStart`.

## Known limits

- The glyphs `✔`, `◉`, `⊖`, `●` and `○` need a font that draws them.
- Where the host's font is not monospaced, long names are cut by the host at the real edge.
- Old sessions' spend is only as exact as the statusline records that were copied in; the board does not re-price
  transcripts.

## Development

`claude plugin test .` runs the tests and `claude plugin validate . --strict` checks the manifest and the module (see
`CONTRIBUTING.md`). The pure logic is in `hooks/statusline.ts`, `hooks/sdlc.ts` and `hooks/core.ts`; the only code that
touches `$.fs` or `$.env` is `hooks/sources.ts`.

## Licence

MIT. Copyright (c) 2026 Tam Mai and Stephen Casella.
