// The band files ai-sdlc writes to `.sdlc/local/band.json` (version 1), as the tests need them.
import type { Sdlc, Stage, StageState } from '../../types'

/** The eight steps' states, in the pipeline's order. */
export const steps = (...s: StageState[]) => ({ intent: s[0], spec: s[1], plan: s[2], build: s[3], verify: s[4], review: s[5], ship: s[6], knowledge: s[7] }) as Record<Stage, StageState>

/** A band file's text: the version, then the line's data. */
export const band = (sdlc: Partial<Sdlc>) => JSON.stringify({ version: 1, ...sdlc })

/** An open tier M change whose build has passed and whose review is next. */
export const REVIEW: Sdlc = {
  activeId: '2026-10-19-open-change',
  tier: 'M',
  next: 'review',
  stages: steps('done', 'done', 'done', 'done', 'done', 'current', 'todo', 'todo'),
  build: [{ step: 'spec', rounds: 2, model: 'sonnet', verdict: 'pass' }],
}

/** A shipped tier S change: no spec and no review, nothing in progress. */
export const SHIPPED: Sdlc = {
  activeId: '2026-10-14-ship-notifies-the-human-when-a-change-is-closed',
  tier: 'S',
  next: 'closed (shipped)',
  stages: steps('done', 'skipped', 'done', 'done', 'done', 'skipped', 'done', 'todo'),
  build: [],
}
