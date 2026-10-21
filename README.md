# session-board

A band above the prompt in Claude Code, in the terminal and the desktop app: one line of your ai-sdlc progress, from real session
events and the files in your project.

It began as a fork of [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT); the pure
reducers and the style of the statusline come from it. See `NOTICE`.

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

One line, the same on the terminal and the desktop app, drawn from the `.sdlc/local/band.json` that ai-sdlc writes (see below):

```
AI-SDLC · Build · Tier M · 2026-10-20-playable-loop         ✔─✔─✔─◉─○─○─○─○  8/9
```

- the title, the step now (in orange), the tier and the change, each after a small dot (the change is cut at the edge when the
  window is narrow); a closed change has no step now, and its outcome follows the change;
- the eight steps (Intent, Spec, Plan, Build, Verify, Review, Ship, Knowledge) as a progress line: marks joined by lines, lit up
  to the current step; a skipped step is dashed (`⊖` in the terminal);
- the build's count (steps that passed out of all of them, the passed number in green; not shown for a build of one step).

The terminal draws it in glyphs inside an orange border; hide it with `/session-board close`. The desktop app draws the pipeline as one
small drawing (a ticked disc for a step done, a ringed dot with a halo for the step now, an open ring for a step to come), with a
close control (`×`) at the end, in the host's own frame (the band draws no border of its own), all in one size of type in the host's font. A
project with no AI-SDLC shows the friendly line instead (see "When something is unavailable"). The editor and the phones get a two-row card (the model and its effort, the limits
as bars, the spend, then the AI-SDLC row) in an orange border.

## Commands

`/session-board [open|close]` shows or hides the band; on the desktop the close control does the same. The `openOnStart` option sets
whether it shows when a session starts.

## When something is unavailable

Any value that cannot be read shows `N/A` and the band keeps drawing: no rate-limit data, a missing cost ledger, a malformed
band file; the board never works the chain out itself. Where the AI-SDLC line cannot be drawn, the band says why in a line of its own,
and what to do:

| Why | The band says |
|---|---|
| no `.sdlc` folder | `AI-SDLC · No AI-SDLC in this project, so there is nothing to show here. /session-board close hides this.` |
| a folder, but no band file | `AI-SDLC · AI-SDLC is here but has not written its band file yet. Update ai-sdlc, then run any sdlc command.` |
| a file that does not parse | `AI-SDLC · AI-SDLC's band file could not be read. It is rewritten on the next sdlc command.` |
| a file of another version | `AI-SDLC · AI-SDLC's band file is of a version this session-board does not know. Update session-board or ai-sdlc.` |

Until the first read of the project has finished the band shows nothing, so it does not flash a wrong message.

## What it reads, and what it never does

It reads the session's own events; `.sdlc/local/band.json`; and, once per project, `~/.claude/statusline-cost/`. The project's spend is the board's own ledger in the
host's store: one record per session, counted as `base + last`, a restarted counter keeping what came before. The first time
it sees a project it copies those statusline records once; after that it never reads them again.

It never writes to your project, runs no program, makes no network request and calls no model. It draws ids, stages and counts,
never transcript or intent text, and strips control characters from everything it reads from your files.

## The band file

ai-sdlc owns where a change stands (its `chainStatus`), so the board does not work it out again: it draws what ai-sdlc writes to
`.sdlc/local/band.json` whenever the chain changes. The file is JSON, version 1; a file of another version, or one that does not
parse, is no band:

```json
{
  "version": 1,
  "activeId": "2026-10-20-playable-loop",
  "tier": "M",
  "next": "build",
  "stages": { "intent": "done", "spec": "done", "plan": "done", "build": "current", "verify": "todo", "review": "todo", "ship": "todo", "knowledge": "todo" },
  "build": [{ "step": "1", "rounds": 1, "model": "sonnet", "verdict": "pass" }]
}
```

- `activeId`: the change in progress; `null` (or no change) draws "no active change", and the other fields are then ignored.
- `stages`: all eight steps, each `done`, `current`, `todo` or `skipped` (tier S skips spec and review; a closed change has no
  `current`). A missing or bad step makes `stages` unknown, drawn as `stages N/A`.
- `next`: what `sdlc status` calls the next step, `closed (shipped)` for a closed change; `build`: the build loop's steps, each
  `verdict` `pass`, another word, or `null` (the band's count is the `pass` rows out of all rows).

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
`CONTRIBUTING.md`). The pure logic is in `hooks/statusline.ts`, `hooks/sdlc.ts` (the band file's validation) and `hooks/core.ts`; the only code that
touches `$.fs` or `$.env` is `hooks/sources.ts`.

## Licence

MIT. Copyright (c) 2026 Tam Mai and Stephen Casella.
