# Changelog

## 0.3.1 (2026-10-21)

- **Change:** where the AI-SDLC line cannot be drawn the band says why instead of hiding: no `.sdlc` folder, a folder with no band
  file, a file that cannot be read, or a file of another version, each with what to do. On the desktop the line has the close
  control; the editor and the phones get it as their second row. Nothing is shown until the first read of the project has finished.

## 0.3.0 (2026-10-21)

- **Breaking:** the band no longer works the chain out itself. It draws `.sdlc/local/band.json`, which ai-sdlc writes (version 1:
  `activeId`, `tier`, `next`, the eight `stages`, the `build` rows; see "The band file" in the README), and no longer reads the
  change's documents, `state.json`, `config.json` or `knowledges/log.md`. A project whose ai-sdlc writes no such file, or a file of
  another version, has no band. Needs an ai-sdlc that writes the file.
- **Change:** the terminal band is the desktop's line in glyphs, in an orange border: `AI-SDLC · Build · Tier M · <change>`, then
  the eight marks and the build's count (`8/9`). The main line (model, limits, spend) is gone from the terminal, and a project with
  no ai-sdlc band has none there. The editor and the phones keep their two-row card.
- **Change:** the desktop band's close control is a plain `×`; the host frames the band, and the band draws no border of its own.

## 0.2.0 (2026-10-20)

- **Change:** only the band above the prompt is left. The pane, the Main, AI-SDLC, Agents and Gate panels, the two-column and
  swimlane layouts and the animated rail are gone, with `/session-board compact` and `reset` and the `panels`, `layout`,
  `maxCards` and `motion` options. `/session-board [open|close]` shows or hides the band; the board no longer reads git, tracks
  subagents or permission checks, or counts compactions.
- **Change:** on the desktop app the band is one line of AI-SDLC, with no border of its own and the host's close control (`×`):
  `AI-SDLC · Build · Tier M · <change>` (the step now in orange), then the small unlabelled pipeline as one SVG drawing and the build's count (`8/9`, the passed number
  in green), all in one size of type. A project with no ai-sdlc files has no band there. The editor and the phones get a two-row
  card. The terminal band is unchanged.
- **Change:** the band's second line is `AI-SDLC <marks>  now Build · next Verify · done 8/9 · <change> · tier M`: the step now in
  orange, the step next and the tier in sky blue, the done count in green (not shown for a build of one step). It reads only the
  active change; the backlog and the other changes are not read.

## 0.1.6 (2026-10-20)

- **Fix:** a backlog written as `## <ID>. <Title>` pitches, with no `## Order` table, now shows in the Backlog list. The table still
  wins when there is one.

## 0.1.5 (2026-10-20)

- **Change:** the AI-SDLC card's Tasks list is now two lists: Intents (the changes being worked on, then the finished ones) and
  Backlog (the next items from `docs/project/backlog.md`). The Backlog list is hidden when the backlog can't be read or has no items.
  The 10-row cap and the 4-item backlog limit are unchanged.

## 0.1.4 (2026-10-20)

- **Fix:** a finished change in the Tasks list is cut at the edge of the row, not 20 columns short of it. Working and pending rows are unchanged.

## 0.1.3 (2026-10-20)

- **Fix:** the progress line stays on Build while a build step has no pass. A `verify.md` left by an earlier group no longer moves
  the change to Review mid-build.

## 0.1.2 (2026-10-20)

- **Fix:** the board no longer goes blank when an agent is resumed. A resumed agent spawned a second card under the same id, the
  engine refused to draw its clock twice, and the whole pane was dropped. Each agent now has one card.

## 0.1.1 (2026-10-20)

- **Fix:** a leftover `verify.md` no longer ticks build and verify while an earlier step (spec, plan) is still in progress.
- The AI-SDLC section no longer shows the `last verify` line or `implementer N/A`; an implementer line appears only when one is recorded.

## 0.1.0 (2026-10-20)

First release: a fork of claude-flightdeck 0.4.0 (commit 6150b9f).

- **Main panel** in three rows: model, effort and working/idle; the `ctx`, `5h` and `7d` gauges with reset times; the git
  branch with the total lines added and removed. Flightdeck's request count and last-request speed are not shown.
- **Heading** with the project's name and its `$session/$project` spend. The project total is the board's own ledger,
  counted like a status line; the statusline's records are copied in once, then never read again.
- **AI-SDLC section** read from the repo's files: an eight-step progress line (an SVG on the desktop app), the step now
  and next, build rounds, last verify, and one Tasks list (working, pending backlog, done; at most 10).
- **Agents and Gate panels** from Flightdeck; its Architect, Loops, Receipt and Log panels are dropped.
- **`/session-board [open|close|compact|reset]`**, and a compact two-line band in an orange border where a pane does not fit.
- **Desktop:** the panels fill the pane, so the room on its left and right is the same; rules and the progress line are SVG sized to the pane; long names are cut by the host; blank rows separate the
  sections (the terminal keeps its rows).
- Every value that cannot be read shows `N/A`; the board never writes to the project, makes no network request and calls no
  model.
