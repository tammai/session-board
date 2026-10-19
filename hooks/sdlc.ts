// Pure ai-sdlc logic: front matter, stage rules, build rows, metrics, backlog order. The stage order is
// ported from ai-sdlc's `chainStatus` (plugin/scripts/lib.mjs), so the board agrees with `sdlc status`.
import type { BuildRow, ChangeSummary, ChecklistItem, Stage, StageState } from '../types'
import { clean } from './core'

export type Meta = Record<string, string>

/** A change's documents by kind: its front matter, or absent when the file is missing. */
export type ChangeDocs = Partial<Record<'intent' | 'design' | 'ui' | 'spec' | 'plan' | 'verify' | 'review', Meta>>

/** The build loop's cap on implement/verify rounds per step (ai-sdlc's `MAX_ROUNDS`). */
export const MAX_ROUNDS = 3

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

const ORDER: Stage[] = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'knowledge']

/**
 * Where a change stands: its tier, the next step (as `sdlc status` names it) and each stage's state.
 * Tier S has no spec or review; a design (tier L, or one that exists) and a ui doc are part of the spec stage.
 */
export const stageOf = (docs: ChangeDocs, isKnowledgeLogged = false): { tier: string; next: string; stages: Record<Stage, StageState> } => {
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
  else if (st('verify') !== 'passed') next = 'build'
  else if (tier !== 'S' && st('review') !== 'approved') next = 'review'
  else next = 'ship'
  if (outcome && next === 'ship') next = `closed (${outcome})`

  const isDone: Record<Stage, boolean> = {
    intent: st('intent') === 'approved',
    spec: st('spec') === 'approved' && (!needsDesign || st('design') === 'approved') && (!docs.ui || st('ui') === 'approved'),
    plan: st('plan') === 'approved',
    // building ends where verify.md begins; verifying ends when it passes
    build: st('verify') !== 'missing',
    verify: st('verify') === 'passed',
    review: st('review') === 'approved',
    ship: outcome === 'shipped',
    // the knowledge step leaves a line for the change in knowledges/log.md
    knowledge: isKnowledgeLogged,
  }
  const stages = {} as Record<Stage, StageState>
  let hasCurrent = false
  for (const s of ORDER) {
    if ((s === 'spec' || s === 'review') && tier === 'S') stages[s] = 'skipped'
    else if (isDone[s]) stages[s] = 'done'
    else if (!hasCurrent && !outcome) {
      stages[s] = 'current'
      hasCurrent = true
    } else stages[s] = 'todo'
  }
  return { tier, next, stages }
}

/** Whether the line after each stage (the one joining it to the next) is lit: up to the furthest stage reached. */
export const stageLinks = (stages: Record<Stage, StageState>): boolean[] => {
  const reached = Math.max(-1, ...ORDER.map((s, i) => (stages[s] === 'done' || stages[s] === 'current' ? i : -1)))
  return ORDER.slice(0, -1).map((_, i) => i + 1 <= reached)
}

/** The step now (the one in progress) and the step next (the one after it, a skipped step never next). */
export const nowNext = (stages: Record<Stage, StageState>): { now: Stage | null; next: Stage | null } => {
  const now = ORDER.find(s => stages[s] === 'current') ?? null
  const next = now ? (ORDER.slice(ORDER.indexOf(now) + 1).find(s => stages[s] !== 'skipped') ?? null) : null
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

/** The most items the checklist holds, and the most of them the backlog may take. */
export const CHECKLIST_CAP = 10
const PENDING_CAP = 4

/**
 * One checklist: the changes being worked on first (the active one on top), the backlog next, and finished changes
 * last, the newest closed first. The whole list is at most `cap`; the backlog shows at most 4 so some finished
 * changes always fit.
 */
export const checklistOf = (changes: ChangeSummary[], backlog: { id: string; title: string }[] | null, activeId: string | null, cap = CHECKLIST_CAP): ChecklistItem[] => {
  const working = changes
    .filter(c => !c.outcome)
    .sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : b.id.localeCompare(a.id)))
    .slice(0, cap)
    .map((c): ChecklistItem => ({ id: c.id, state: 'working', note: c.next }))
  const pending = (backlog ?? [])
    .slice(0, Math.min(PENDING_CAP, cap - working.length))
    .map((b): ChecklistItem => ({ id: b.id, state: 'pending', note: b.title }))
  const done = changes
    .filter(c => c.outcome)
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, cap - working.length - pending.length)
    .map((c): ChecklistItem => ({ id: c.id, state: 'done', note: null }))
  return [...working, ...pending, ...done]
}

/** The rows of the table under the `## Order` heading, in order. */
export const parseBacklogOrder = (markdown: string): { id: string; title: string }[] => {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(l => /^##\s+Order\s*$/.test(l))
  if (start < 0) return []
  const rows: { id: string; title: string }[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    if (!line.startsWith('|')) {
      if (rows.length > 0) break
      continue
    }
    const cells = line.split('|').map(c => c.trim())
    const id = cells[1]
    const title = cells[2]
    if (!id || !title || /^-+$/.test(id) || id === 'ID') continue
    rows.push({ id: clean(id), title: clean(title.replace(/`/g, '')) })
  }
  return rows
}
