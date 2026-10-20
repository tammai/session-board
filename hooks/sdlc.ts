// Pure ai-sdlc logic: front matter, stage rules, build rows. The stage order is
// ported from ai-sdlc's `chainStatus` (plugin/scripts/lib.mjs), so the board agrees with `sdlc status`.
import type { BuildRow, Stage, StageState } from '../types'
import { clean } from './core'

export type Meta = Record<string, string>

/** A change's documents by kind: its front matter, or absent when the file is missing. */
export type ChangeDocs = Partial<Record<'intent' | 'design' | 'ui' | 'spec' | 'plan' | 'verify' | 'review', Meta>>

/** The `key: value` lines between the `---` fences, or null when the text has no front matter. */
export const parseFrontMatter = (text: string): Meta | null => {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!m || m[1] === undefined) return null
  const meta: Meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv?.[1] !== undefined) meta[kv[1]] = clean(kv[2] ?? '').trim()
  }
  return meta
}

/** The pipeline's eight steps, in order, and what each is called. */
export const STAGES: Stage[] = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'knowledge']
export const LABELS: Record<Stage, string> = { intent: 'Intent', spec: 'Spec', plan: 'Plan', build: 'Build', verify: 'Verify', review: 'Review', ship: 'Ship', knowledge: 'Knowledge' }

/**
 * Where a change stands: its tier, the next step (as `sdlc status` names it) and each stage's state.
 * Tier S has no spec or review; a design (tier L, or one that exists) and a ui doc are part of the spec stage.
 */
export const stageOf = (docs: ChangeDocs, isKnowledgeLogged = false, isBuildOpen = false): { tier: string; next: string; stages: Record<Stage, StageState> } => {
  const tier = docs.intent?.tier || 'M'
  const st = (k: keyof ChangeDocs) => (docs[k] ? docs[k]?.status || 'draft' : 'missing')
  const outcome = docs.intent?.outcome || ''
  const needsDesign = tier === 'L' || Boolean(docs.design)

  let next: string
  if (st('intent') === 'rejected') next = 'closed (intent rejected)'
  else if (st('intent') !== 'approved') next = 'intent'
  else if (needsDesign && st('design') !== 'approved') next = 'design'
  else if (docs.ui && st('ui') !== 'approved') next = 'ui'
  else if (tier !== 'S' && st('spec') !== 'approved') next = 'spec'
  else if (st('plan') !== 'approved') next = 'plan'
  else if (st('verify') !== 'passed' || isBuildOpen) next = 'build'
  else if (tier !== 'S' && st('review') !== 'approved') next = 'review'
  else next = 'ship'
  if (outcome && next === 'ship') next = `closed (${outcome})`

  const isDone: Record<Stage, boolean> = {
    intent: st('intent') === 'approved',
    spec: st('spec') === 'approved' && (!needsDesign || st('design') === 'approved') && (!docs.ui || st('ui') === 'approved'),
    plan: st('plan') === 'approved',
    // building ends where verify.md begins; verifying ends when it passes
    build: st('verify') !== 'missing' && !isBuildOpen,
    verify: st('verify') === 'passed' && !isBuildOpen,
    review: st('review') === 'approved',
    ship: outcome === 'shipped',
    // the knowledge step leaves a line for the change in knowledges/log.md
    knowledge: isKnowledgeLogged,
  }
  const stages = {} as Record<Stage, StageState>
  let hasCurrent = false
  for (const s of STAGES) {
    if ((s === 'spec' || s === 'review') && tier === 'S') stages[s] = 'skipped'
    // build and verify are read from verify.md: a stale one must not tick them while an earlier step is still in progress
    else if (isDone[s] && !((s === 'build' || s === 'verify') && hasCurrent && !outcome)) stages[s] = 'done'
    else if (!hasCurrent && !outcome) {
      stages[s] = 'current'
      hasCurrent = true
    } else stages[s] = 'todo'
  }
  return { tier, next, stages }
}

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

/** The build loop's steps (`state.build[id].steps`) as rows; any other shape gives none. */
export const buildRows = (steps: unknown): BuildRow[] => {
  if (typeof steps !== 'object' || steps === null || Array.isArray(steps)) return []
  const rows: BuildRow[] = []
  for (const [step, v] of Object.entries(steps as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue
    const s = v as { rounds?: unknown; model?: unknown; verdict?: unknown }
    rows.push({
      step: clean(step),
      rounds: typeof s.rounds === 'number' && Number.isFinite(s.rounds) ? s.rounds : 0,
      model: typeof s.model === 'string' ? clean(s.model) : '',
      verdict: typeof s.verdict === 'string' ? clean(s.verdict) : null,
    })
  }
  return rows
}
