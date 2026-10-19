// Front matter copied from real ai-sdlc change folders (bodies dropped). Tier S skips spec and review.
export const TIER_S: Record<string, string> = {
  intent: `---
id: 2026-10-14-ship-notifies-the-human-when-a-change-is-closed
artifact: intent
status: approved
tier: S
kind: feature
source: human
approved_at: 2026-10-14T02:13:38Z
outcome: shipped
closed_at: 2026-10-14T02:14:48Z
---
# Intent`,
  plan: `---
id: 2026-10-14-ship-notifies-the-human-when-a-change-is-closed
artifact: plan
status: approved
tier: S
---
# Plan`,
  verify: `---
id: 2026-10-14-ship-notifies-the-human-when-a-change-is-closed
artifact: verify
status: passed
attempts: 1
last_run: 2026-10-14T02:14:28Z
---
# Verification`,
}

export const TIER_M: Record<string, string> = {
  intent: `---
id: 2026-10-14-learn-and-policy-redefined
artifact: intent
status: approved
tier: M
outcome: shipped
spec_rework: 6
plan_edits: 14
---
# Intent`,
  spec: `---
id: 2026-10-14-learn-and-policy-redefined
artifact: spec
status: approved
tier: M
---
# Spec`,
  plan: `---
id: 2026-10-14-learn-and-policy-redefined
artifact: plan
status: approved
tier: M
---
# Plan`,
  verify: `---
id: 2026-10-14-learn-and-policy-redefined
artifact: verify
status: passed
attempts: 1
---
# Verification`,
  review: `---
id: 2026-10-14-learn-and-policy-redefined
artifact: review
status: approved
tier: M
---
# Review`,
}

export const BACKLOG = `# Backlog

## How an item runs
- Not a table.

## Order
| ID | Title | Appetite | Depends on |
|---|---|---|---|
| D1 | Worktree support | L, about 11 h | — |
| L2 | \`session-board\`, remade separately | L | — |

Release notes follow here.
`
