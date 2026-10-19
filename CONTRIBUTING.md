# Contributing

- `claude plugin test .` runs the tests; `claude plugin validate . --strict` checks the manifest and the module. Run both
  before a change. Type-checking uses a `tsconfig.json` that extends the types the engine writes into `.claude-plugin/types/`
  when the mod loads.
- Keep tests few: one per behaviour a person can see, at the lowest level that proves it. The pure logic
  (`hooks/statusline.ts`, `hooks/sdlc.ts`, `hooks/core.ts`) is tested directly; the drawing is tested by mounting the pane on
  the terminal and desktop surfaces.
- Only `hooks/sources.ts` touches `$.fs`, `$.process` or `$.env`, and every read in it returns a value or `null` (drawn as
  `N/A`). Keep it that way: a missing file or a failed read must never throw into the drawing.
- Do not add a write to the project, a network call or a model call.
- A function that takes `$` must be a top-level function declaration (the engine follows `$` only into those).
- Commits are conventional: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- `hooks/core.ts` (the agents and gate logic), `hooks/panels.tsx`, `hooks/rail.tsx` and `hooks/elapsed.tsx` come from
  claude-flightdeck (MIT); keep `NOTICE` and the copyright in `LICENSE`.
