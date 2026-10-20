# Changelog

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
