import { expect, test } from 'claude-code/testing'

import { shorten } from '../hooks/core'
import type { Stage, StageState } from '../types'
import { nowNext, parseBand, stageLinks } from '../hooks/sdlc'
import { REVIEW, SHIPPED, band, steps as stepsOf } from './fixtures/sdlc'

const parsed = (text: string) => parseBand(JSON.parse(text) as unknown)

test('a version 1 band file reads as the line it describes; the stages and build rows come through whole', () => {
  expect(parsed(band(REVIEW))).toEqual(REVIEW)
  expect(parsed(band(SHIPPED))).toEqual(SHIPPED)
})

test('a file with no active change reads as that; a file of another version or shape reads as none', () => {
  expect(parsed(band({ activeId: null, tier: 'M' }))).toEqual({ activeId: null, tier: null, stages: null, next: null, build: null })
  expect([parseBand(null), parseBand('junk'), parseBand([]), parseBand({}), parseBand({ version: 2, ...REVIEW }), parseBand({ ...REVIEW })]).toEqual([null, null, null, null, null, null])
})

test('a value of the wrong shape inside the file is unknown, not a throw: stages with a bad or missing step, build rows of other shapes', () => {
  const { stages, ...rest } = REVIEW
  expect(parseBand({ version: 1, ...rest, stages: { ...stepsOf('done', 'done', 'done', 'done', 'done', 'current', 'todo', 'todo'), ship: 'soon' } })?.stages).toBe(null)
  expect(parseBand({ version: 1, ...rest, stages: { intent: 'done' } })?.stages).toBe(null)
  expect(parseBand({ version: 1, ...rest, stages })?.stages).toEqual(stages)
  expect(parseBand({ version: 1, ...rest, build: 'x' })?.build).toBe(null)
  expect(parseBand({ version: 1, ...rest, build: [{ step: 'plan', rounds: 1 }, 'b', null, { step: 'spec', rounds: 'many', model: 7, verdict: 'fail' }] })?.build).toEqual([
    { step: 'plan', rounds: 1, model: '', verdict: null },
    { step: 'spec', rounds: 0, model: '', verdict: 'fail' },
  ])
  expect(parseBand({ version: 1, activeId: 'x' })).toEqual({ activeId: 'x', tier: null, stages: null, next: null, build: null })
})

test('text read from the repo never carries control characters on to the terminal', () => {
  const esc = '\u001b[31m'
  const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s)
  const dirty = parseBand({ version: 1, activeId: `a${esc}b`, tier: `${esc}L\u0007`, next: `${esc}ship`, stages: null, build: [{ step: `sp${esc}ec`, rounds: 1, model: `${esc}opus`, verdict: `${esc}pass` }] })
  const strings = [dirty?.activeId, dirty?.tier, dirty?.next, ...(dirty?.build ?? []).flatMap(r => [r.step, r.model, r.verdict])]
  expect(strings.every(x => !hasControl(x ?? ''))).toBe(true)
  expect(hasControl(shorten(`a${esc}b\u0007c`, 20))).toBe(false)
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
