import { expect, test } from 'claude-code/testing'

import { describeInput, effortFromSettings, normalizeCard, normalizeSdlc, redact, uniqueCards } from '../hooks/core'

test('a resumed agent keeps one card: its id is drawn once, by its latest spawn', () => {
  const card = (id: string, description: string) => ({ ...normalizeCard({}), id, description })
  const cards = uniqueCards([card('a1', 'Write plan'), card('b2', 'Audit'), card('a1', 'Revise plan')])
  expect(cards.map(c => `${c.id}:${c.description}`)).toEqual(['b2:Audit', 'a1:Revise plan'])
})

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

test("the effort level is read from the settings: the model's own first, then the general one; anything else is unknown", () => {
  const settings = { effortLevel: 'low', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'high' } } }
  expect(effortFromSettings(settings, 'claude-sonnet-5-5')).toBe('high')
  expect(effortFromSettings(settings, 'claude-opus-5-5')).toBe('low')
  expect(effortFromSettings({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'max' } } }, 'claude-opus-5-5[1m]')).toBe('max') // [1m] is not part of the key
  expect(effortFromSettings({ modelSettings: { x: { effortLevel: 5 } }, effortLevel: 7 }, 'x')).toBe(null) // only a level's name counts
  expect([effortFromSettings(null, 'x'), effortFromSettings('junk', null), effortFromSettings({}, 'x')]).toEqual([null, null, null])
})

test('an ai-sdlc value saved by an older version reads as none rather than breaking the drawing', () => {
  const current = { activeId: null, tier: null, stages: null, next: null, isDirty: null, lastVerifyAt: null, build: null, implementers: null, maxRounds: 3, checklist: [], isPendingKnown: true }
  expect(normalizeSdlc(current)).toEqual(current)
  // the version before the checklist kept `recent` and `backlog`: until the next read rewrites it, there is no section
  expect(normalizeSdlc({ ...current, checklist: undefined, recent: [] })).toBe(null)
  expect([normalizeSdlc(null), normalizeSdlc('junk'), normalizeSdlc({})]).toEqual([null, null, null])
})
