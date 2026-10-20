/** What the main loop reports about itself. Null until known; drawn as N/A. */
export type Main = {
  model: string | null
  effort: string | null
  isRunning: boolean
}

export type Usage = {
  pct: number | null
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
}

/** The project's spend, the second half of the band's `$session/$project`. Null when it could not be read. */
export type Status = { projectCost: number | null }

/** Whether the band shows: null follows the `openOnStart` option; `/session-board open` and `close` set it. */
export type View = { isShown: boolean | null }

/** The pipeline's eight steps (ai-sdlc's docs/pipeline.svg), in order. */
export type Stage = 'intent' | 'spec' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'knowledge'
export type StageState = 'done' | 'current' | 'todo' | 'skipped'

export type BuildRow = { step: string; rounds: number; verdict: string | null; model: string }

/** The AI-SDLC line's data. The whole value is null when the project has no ai-sdlc files. */
export type Sdlc = {
  activeId: string | null
  tier: string | null
  stages: Record<Stage, StageState> | null
  next: string | null
  build: BuildRow[] | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-board': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      status: Status
      sdlc: Sdlc | null
      view: View
    }
  }
}
