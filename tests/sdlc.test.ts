import { expect, test } from 'claude-code/testing'

import { shorten } from '../hooks/core'
import type { Stage, StageState } from '../types'
import { buildRows, checklistOf, nowNext, parseBacklogOrder, parseFrontMatter, stageLinks, stageOf } from '../hooks/sdlc'
import type { ChangeDocs } from '../hooks/sdlc'
import { BACKLOG, TIER_M, TIER_S } from './fixtures/sdlc'

const docsOf = (raw: Record<string, string>): ChangeDocs => {
  const out: ChangeDocs = {}
  for (const [k, text] of Object.entries(raw)) {
    const meta = parseFrontMatter(text)
    if (meta) (out as Record<string, unknown>)[k] = meta
  }
  return out
}

test('front matter reads past a BOM and CRLF; text without any gives null', () => {
  const text = '﻿---\r\nartifact: intent\r\nstatus: approved\r\ntier: L\r\n---\r\n# body'
  expect(parseFrontMatter(text)).toEqual({ artifact: 'intent', status: 'approved', tier: 'L' })
  expect(parseFrontMatter('# just a heading')).toBe(null)
  expect(parseFrontMatter('')).toBe(null)
})

test('tier S skips spec and review; a closed change is done through ship', () => {
  const r = stageOf(docsOf(TIER_S))
  expect(r.stages).toEqual({ intent: 'done', spec: 'skipped', plan: 'done', build: 'done', verify: 'done', review: 'skipped', ship: 'done', knowledge: 'todo' })
  expect(r.next).toBe('closed (shipped)')
  expect(r.tier).toBe('S')
})

test('an open tier M change waits at review once build has passed', () => {
  const { review: _review, ...rest } = TIER_M
  const open = { ...rest, intent: (TIER_M.intent as string).replace('outcome: shipped\n', '') }
  const r = stageOf(docsOf(open))
  expect(r.stages).toEqual({ intent: 'done', spec: 'done', plan: 'done', build: 'done', verify: 'done', review: 'current', ship: 'todo', knowledge: 'todo' })
  expect(r.next).toBe('review')
})

test('the chain order follows ai-sdlc: rejected intent, design, ui, then nothing at all', () => {
  const intent = (extra: string) => `---\nartifact: intent\nstatus: approved\ntier: M\n${extra}---\n`
  expect(stageOf(docsOf({ intent: '---\nartifact: intent\nstatus: rejected\ntier: M\n---\n' })).next).toBe('closed (intent rejected)')
  const l = stageOf(docsOf({ intent: intent('').replace('tier: M', 'tier: L') }))
  expect(l.next).toBe('design')
  expect(l.stages.spec).toBe('current')
  const ui = stageOf(docsOf({ intent: intent(''), ui: '---\nartifact: ui\nstatus: draft\n---\n' }))
  expect(ui.next).toBe('ui')
  const none = stageOf({})
  expect(none.next).toBe('intent')
  expect(none.stages.intent).toBe('current')
})

test('build rows come from the steps map and tolerate any other shape', () => {
  expect(buildRows({ spec: { rounds: 2, model: 'sonnet', verdict: 'fail' } })).toEqual([{ step: 'spec', rounds: 2, model: 'sonnet', verdict: 'fail' }])
  expect(buildRows({ plan: { rounds: 1 } })).toEqual([{ step: 'plan', rounds: 1, model: '', verdict: null }])
  expect([buildRows(undefined), buildRows('x'), buildRows(7), buildRows({ a: 'b' })]).toEqual([[], [], [], []])
})

const change = (id: string, outcome: string | null, closedAt: string | null = null) => ({
  id,
  next: outcome ? `closed (${outcome})` : 'review',
  outcome,
  closedAt,
})

test('the checklist has what is being worked on first, the backlog next, and finished changes last, newest closed first', () => {
  const changes = [
    change('a-open', null),
    change('b-active', null),
    change('d1', 'shipped', '2026-10-01T00:00:00Z'),
    change('d2', 'shipped', '2026-10-03T00:00:00Z'),
    change('d3', 'shipped'), // closed, but with no date: after the dated ones
  ]
  const backlog = [
    { id: 'D1', title: 'First' },
    { id: 'D2', title: 'Second' },
  ]
  const list = checklistOf(changes, backlog, 'b-active')
  expect(list.map(i => `${i.state}:${i.id}`)).toEqual(['working:b-active', 'working:a-open', 'pending:D1', 'pending:D2', 'done:d2', 'done:d1', 'done:d3'])
  expect(list[0]?.note).toBe('review') // a working change carries its next step
  expect(list[2]?.note).toBe('First') // a pending one its title
  expect(checklistOf(changes, null, null).some(i => i.state === 'pending')).toBe(false) // no backlog to read: none pending
})

test('the checklist holds at most 10: the backlog shows 4 at most and the finished changes fill the rest', () => {
  const closed = Array.from({ length: 8 }, (_, i) => change(`c${i}`, 'shipped', `2026-10-0${i + 1}T00:00:00Z`))
  const backlog = Array.from({ length: 6 }, (_, i) => ({ id: `B${i}`, title: `Item ${i}` }))
  const list = checklistOf([change('open', null), ...closed], backlog, 'open')
  expect(list).toHaveLength(10)
  expect(list.map(i => i.state)).toEqual(['working', 'pending', 'pending', 'pending', 'pending', 'done', 'done', 'done', 'done', 'done'])
  expect(list.at(-1)?.id).toBe('c3') // the five newest closed: c7 .. c3
  const crowded = Array.from({ length: 12 }, (_, i) => change(`w${i}`, null))
  expect(checklistOf(crowded, backlog, null)).toHaveLength(10)
})

test('the backlog order is the table under ## Order; no such heading gives nothing', () => {
  expect(parseBacklogOrder(BACKLOG)).toEqual([
    { id: 'D1', title: 'Worktree support' },
    { id: 'L2', title: 'session-board, remade separately' },
  ])
  expect(parseBacklogOrder('# Backlog\n\nno table here')).toEqual([])
})

test('text read from the repo never carries control characters on to the terminal', () => {
  const esc = '\u001b[31m'
  const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s)
  expect(hasControl(parseFrontMatter(`---\ntier: ${esc}L\u0007\n---\n`)?.tier ?? '')).toBe(false)
  expect(parseBacklogOrder(`## Order\n| ID | Title |\n|---|---|\n| D1 | ${esc}Evil\u001b]0;x\u0007 |\n`).every(r => !hasControl(r.title))).toBe(true)
  expect(buildRows({ [`sp${esc}ec`]: { rounds: 1, model: `${esc}opus`, verdict: `${esc}pass` } }).every(r => !hasControl(r.step + r.model + (r.verdict ?? '')))).toBe(true)
  expect(hasControl(shorten(`a${esc}b\u0007c`, 20))).toBe(false)
})

test('the eight steps of the pipeline: build ends where verify.md begins, and knowledge is done once it is logged', () => {
  const approved = (artifact: string) => ({ artifact, status: 'approved', tier: 'M' })
  const base = { intent: approved('intent'), spec: approved('spec'), plan: approved('plan') }
  // the plan is approved and nothing is verified yet: building
  expect(stageOf(base).stages).toMatchObject({ plan: 'done', build: 'current', verify: 'todo' })
  // a verify.md that has not passed: the code is built, verification is what is open
  expect(stageOf({ ...base, verify: { artifact: 'verify', status: 'failed' } }).stages).toMatchObject({ build: 'done', verify: 'current' })
  // passed, then reviewed and shipped: knowledge is open until its log line is there
  const shipped = { ...base, verify: { artifact: 'verify', status: 'passed' }, review: approved('review'), intent: { ...approved('intent'), outcome: 'shipped' } }
  expect(stageOf(shipped).stages.knowledge).toBe('todo')
  expect(stageOf(shipped, true).stages).toMatchObject({ ship: 'done', knowledge: 'done' })
})

test('a stale verify.md does not tick build and verify while the plan is still open', () => {
  const docs = { intent: { artifact: 'intent', status: 'approved', tier: 'M' }, spec: { artifact: 'spec', status: 'approved' }, plan: { artifact: 'plan', status: 'draft' }, verify: { artifact: 'verify', status: 'passed' } }
  expect(stageOf(docs).stages).toMatchObject({ plan: 'current', build: 'todo', verify: 'todo' })
})

test('the lines between steps are lit up to the current one, grey after it', () => {
  const steps = (...s: StageState[]) => ({ intent: s[0], spec: s[1], plan: s[2], build: s[3], verify: s[4], review: s[5], ship: s[6], knowledge: s[7] }) as Record<Stage, StageState>
  // Intent, Spec skipped, Plan, Build now: the first three lines are lit, the four after Build are not
  expect(stageLinks(steps('done', 'skipped', 'done', 'current', 'todo', 'skipped', 'todo', 'todo'))).toEqual([true, true, true, false, false, false, false])
  expect(stageLinks(steps('done', 'skipped', 'done', 'done', 'done', 'skipped', 'done', 'done'))).toEqual([true, true, true, true, true, true, true])
  expect(stageLinks(steps('current', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'))).toEqual([false, false, false, false, false, false, false])
})

test('the step now is the current one; the step next is the one after it, a skipped step never next', () => {
  const steps = (...s: StageState[]) => ({ intent: s[0], spec: s[1], plan: s[2], build: s[3], verify: s[4], review: s[5], ship: s[6], knowledge: s[7] }) as Record<Stage, StageState>
  expect(nowNext(steps('done', 'done', 'done', 'done', 'done', 'current', 'todo', 'todo'))).toEqual({ now: 'review', next: 'ship' })
  // tier S: verify is done, review skipped, ship now, knowledge next
  expect(nowNext(steps('done', 'skipped', 'done', 'done', 'done', 'skipped', 'current', 'todo'))).toEqual({ now: 'ship', next: 'knowledge' })
  // tier S with verify now: review is skipped, so ship is next
  expect(nowNext(steps('done', 'skipped', 'done', 'done', 'current', 'skipped', 'todo', 'todo'))).toEqual({ now: 'verify', next: 'ship' })
  expect(nowNext(steps('done', 'done', 'done', 'done', 'done', 'done', 'done', 'current'))).toEqual({ now: 'knowledge', next: null }) // nothing after the last
  expect(nowNext(steps('done', 'skipped', 'done', 'done', 'done', 'skipped', 'done', 'todo'))).toEqual({ now: null, next: null }) // nothing in progress
})
