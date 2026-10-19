# session-board

A live board for Claude Code, in the terminal and the desktop app. One pane shows the model and its limits, your ai-sdlc
progress, the subagents, and every permission check, all from real session events and the files in your project.

It is a fork of [claude-flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT): the agents and
gate panels, the pane layout and the animated rail come from it. See `NOTICE`.

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

The board is headed by the project's name and `$session/$project` spend.

**Main** is a boxed panel with three rows:
- the model with its effort, and `● working` or `○ idle`;
- the gauges, separated by dots: `ctx` (a percent, with its compactions), then `5h` and `7d` with the time to each reset;
- the git branch (yellow when the tree has changes) and the total lines added and removed against `HEAD`, as `+12 -3`
  (tracked files only).

The gauges are drawn as in a status line: five block cells, green to 50%, orange above, red from 80%.

**AI-SDLC** appears only in a project that has `.sdlc/` or `docs/sdlc/`:
- the active change and its tier;
- an eight-step progress line (Intent, Spec, Plan, Build, Verify, Review, Ship, Knowledge) with marks joined by lines, lit
  up to the current step; narrow boards name only the current step and show the others by their first letter; the desktop
  app draws it as an SVG;
- the step now and the step next, unverified edits, build rounds against the cap, the last verify and the implementer;
- **Tasks**, one list of at most 10: `[>]` the changes being worked on, `[ ]` the next backlog items (up to 4), `[x]` finished
  changes, newest closed first.

**Agents** shows subagents as side-by-side cards with live context and a clock, switching to swimlanes when there are many.

**Gate** shows one cell per permission check with per-family drill-downs. Credentials are masked.

Docked from 110 columns the panels sit in two columns. Where a pane does not fit, a compact band shows above the prompt in
an orange border: line 1 is the status, the model with its effort, `ctx`, `5h` and `7d` as percents with their resets, and the
spend; line 2 is the AI-SDLC progress line with the step now and the step next.

## Commands

`/session-board [open|close|compact|reset]`. `compact` shows the band instead of the pane; `reset` clears agents and
permission checks.

## When something is unavailable

Any value that cannot be read shows `N/A` and the board keeps drawing: no git, no rate-limit data, a missing cost ledger,
a malformed change file. Git is not available in the desktop app (the mod API runs processes in the CLI only), so there the
branch and the changes read `N/A`. A project with no ai-sdlc files has no AI-SDLC section.

## What it reads, and what it never does

It reads the session's own events; `git status` and `git diff --numstat` in the session folder; `.sdlc/*.json`;
`docs/sdlc/*/*.md` front matter; `knowledges/log.md`; `docs/project/backlog.md`; and, once per project,
`~/.claude/statusline-cost/`. The project's spend is the board's own ledger in the host's store: one record per session,
counted as `base + last`, a restarted counter keeping what came before. The first time it sees a project it copies those
statusline records once; after that it never reads them again.

It never writes to your project, makes no network request and calls no model. It draws ids, stages and counts, never
transcript or intent text, and strips control characters from everything it reads from your files.

`git status` can run programs a repository's own configuration names (filter drivers). The board switches off
`core.fsmonitor`, but that cannot be closed entirely: open a repository you do not trust with the board closed.

## Options

Set in `/config` or under `pluginConfigs["session-board"].options` in `settings.json`: `panels` (order, default
`main,sdlc,agents,gate`), `layout` (`auto`, `compact`, `wide`), `maxCards` (1-6), `motion`, `palette` (`theme`, `pastel`)
and `openOnStart`.

## Known limits

- The glyphs `⎇`, `✔`, `◉`, `⊖` and the block cells need a font that draws them.
- Where the host's font is not monospaced, long names are cut by the host at the real edge, and the rules and the progress
  line are SVG, sized to the pane (about 8.5 px a column).
- Old sessions' spend is only as exact as the statusline records that were copied in; the board does not re-price
  transcripts.

## Development

`claude plugin test .` runs the tests and `claude plugin validate . --strict` checks the manifest and the module (see
`CONTRIBUTING.md`). The pure logic is in `hooks/statusline.ts`, `hooks/sdlc.ts` and `hooks/core.ts`; the only code that
touches `$.fs`, `$.process` or `$.env` is `hooks/sources.ts`.

## Licence

MIT. Copyright (c) 2026 Tam Mai and Stephen Casella.
