# Security

session-board runs inside Claude Code with your permissions. What it does, and does not do:

- It reads session events, `git status` and `git diff --numstat` in the session folder, a few files under `.sdlc/`, `docs/`
  and `knowledges/`, and, once per project, `~/.claude/statusline-cost/`.
- It never writes to your project, makes no network request and calls no model.
- It keeps its own cost ledger in the host's per-plugin store.
- Text it reads from your files has control characters removed before it is drawn; credentials in permission checks are masked
  before they are stored.
- `git status` can run programs that a repository's own configuration names (for example filter drivers). The board turns off
  `core.fsmonitor`, which does not close this entirely. Do not run it in a repository you do not trust.

To report a vulnerability, open a private security advisory on the repository's Security tab rather than a public issue.
