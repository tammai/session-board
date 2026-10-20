# Security

session-board runs inside Claude Code with your permissions. What it does, and does not do:

- It reads session events, a few files under `.sdlc/`, `docs/` and `knowledges/`, and, once per project,
  `~/.claude/statusline-cost/`.
- It never writes to your project, runs no program, makes no network request and calls no model.
- It keeps its own cost ledger in the host's per-plugin store.
- Text it reads from your files has control characters removed before it is drawn.

To report a vulnerability, open a private security advisory on the repository's Security tab rather than a public issue.
