// The AI-SDLC line's data. ai-sdlc works out where a change stands (its `chainStatus`) and writes it to `.sdlc/local/band.json`; the
// board only reads that file (hooks/sources.ts), validates it here, and draws it. Pure: nothing here touches `$`.
import type { BandNote, BuildRow, Sdlc, Stage, StageState } from '../types'
import { clean } from './core'

/** Where ai-sdlc writes the band's data, from the project root. */
export const BAND_FILE = '.sdlc/local/band.json'

/** The file's own version: a file of another version reads as none, so the band waits for ai-sdlc to write one it knows. */
export const BAND_VERSION = 1

/** The pipeline's eight steps, in order, and what each is called. */
export const STAGES: Stage[] = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'knowledge']
export const LABELS: Record<Stage, string> = { intent: 'Intent', spec: 'Spec', plan: 'Plan', build: 'Build', verify: 'Verify', review: 'Review', ship: 'Ship', knowledge: 'Knowledge' }

/** Whether the line after each stage (the one joining it to the next) is lit: up to the furthest stage reached. */
export const stageLinks = (stages: Record<Stage, StageState>): boolean[] => {
  const reached = Math.max(-1, ...STAGES.map((s, i) => (stages[s] === 'done' || stages[s] === 'current' ? i : -1)))
  return STAGES.slice(0, -1).map((_, i) => i + 1 <= reached)
}

/** The step now (the one in progress) and the step next (the one after it, a skipped step never next). */
export const nowNext = (stages: Record<Stage, StageState>): { now: Stage | null; next: Stage | null } => {
  const now = STAGES.find(s => stages[s] === 'current') ?? null
  const next = now ? (STAGES.slice(STAGES.indexOf(now) + 1).find(s => stages[s] !== 'skipped') ?? null) : null
  return { now, next }
}

const STATES: StageState[] = ['done', 'current', 'todo', 'skipped']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' && clean(v).trim() !== '' ? clean(v).trim() : null)

/** The eight steps' states, or null unless every step has one of the four. */
const stagesOf = (v: unknown): Record<Stage, StageState> | null => {
  if (!isObject(v)) return null
  const out = {} as Record<Stage, StageState>
  for (const s of STAGES) {
    const state = v[s]
    if (typeof state !== 'string' || !STATES.includes(state as StageState)) return null
    out[s] = state as StageState
  }
  return out
}

/** The build loop's steps as rows; a row of any other shape is dropped, a value that is no list gives null. */
const rowsOf = (v: unknown): BuildRow[] | null =>
  Array.isArray(v)
    ? v.filter(isObject).map(r => ({
        step: text(r.step) ?? '',
        rounds: typeof r.rounds === 'number' && Number.isFinite(r.rounds) ? r.rounds : 0,
        model: text(r.model) ?? '',
        verdict: text(r.verdict),
      }))
    : null

/**
 * The AI-SDLC line's data from the parsed band file. None (no band) when it is not a version-1 object. A file with no active
 * change draws as "no active change"; any value of another shape inside one is unknown (null), never a throw, and every string
 * is stripped of control characters before it reaches the terminal.
 */
export const parseBand = (raw: unknown): Sdlc | null => {
  if (!isObject(raw) || raw.version !== BAND_VERSION) return null
  const activeId = text(raw.activeId)
  if (!activeId) return { activeId: null, tier: null, stages: null, next: null, build: null }
  return { activeId, tier: text(raw.tier), stages: stagesOf(raw.stages), next: text(raw.next), build: rowsOf(raw.build) }
}

/** What the band says in place of the AI-SDLC line when it cannot be drawn: what is missing, and what to do about it. */
export const NOTES: Record<BandNote, string> = {
  'no-sdlc': 'No AI-SDLC in this project, so there is nothing to show here. /session-board close hides this.',
  'no-file': 'AI-SDLC is here but has not written its band file yet. Update ai-sdlc, then run any sdlc command.',
  unreadable: "AI-SDLC's band file could not be read. It is rewritten on the next sdlc command.",
  version: "AI-SDLC's band file is of a version this session-board does not know. Update session-board or ai-sdlc.",
}
