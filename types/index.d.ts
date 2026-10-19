export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

/** What the main loop reports about itself. Null until known; drawn as N/A. */
export type Main = {
  model: string | null
  effort: string | null
  isRunning: boolean
}

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
  /** Times the main loop's context was compacted this session. */
  compactions: number
}

/** The Status row's non-session facts. Every field null when it could not be read. */
export type Status = {
  /** The project's folder name: the board's title. */
  folder: string | null
  branch: string | null
  /** Changed files, from `git status`; colours the branch chip. */
  dirty: number | null
  /** Total lines added and removed against HEAD (tracked files); null where git cannot say. */
  added: number | null
  removed: number | null
  projectCost: number | null
}

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
}

export type Layout = 'auto' | 'compact' | 'wide'

export type View = { expanded: string | null; gateOpen: Bucket | null; layout: Layout | null }

/** The pipeline's eight steps (ai-sdlc's docs/pipeline.svg), in order. */
export type Stage = 'intent' | 'spec' | 'plan' | 'build' | 'verify' | 'review' | 'ship' | 'knowledge'
export type StageState = 'done' | 'current' | 'todo' | 'skipped'

export type ChangeSummary = {
  id: string
  next: string | null
  outcome: string | null
  /** When the change was closed (an ISO time from its intent); null when it is open or undated. */
  closedAt: string | null
}

/** One line of the checklist: a change being worked on, a backlog item still to come, or a finished change. */
export type ChecklistItem = { id: string; state: 'working' | 'pending' | 'done'; note: string | null }

export type BuildRow = { step: string; rounds: number; verdict: string | null; model: string }

/** The AI-SDLC section's data. The whole value is null when the project has no ai-sdlc files. */
export type Sdlc = {
  activeId: string | null
  tier: string | null
  stages: Record<Stage, StageState> | null
  next: string | null
  isDirty: boolean | null
  lastVerifyAt: string | null
  build: BuildRow[] | null
  implementers: { agent: string; model: string }[] | null
  maxRounds: number
  /** Working first, then the backlog, then finished changes, at most 10. */
  checklist: ChecklistItem[]
  /** False where the backlog could not be read: the list has no pending items and says so. */
  isPendingKnown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-board': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      status: Status
      sdlc: Sdlc | null
      gate: Gate
      agents: AgentCard[]
      view: View
    }
  }
}
