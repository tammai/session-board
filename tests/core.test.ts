import { expect, test } from 'claude-code/testing'

import { effortFromSettings, normalizeSdlc, parseConfig } from '../hooks/core'

test("the effort level is read from the settings: the model's own first, then the general one; anything else is unknown", () => {
  const settings = { effortLevel: 'low', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'high' } } }
  expect(effortFromSettings(settings, 'claude-sonnet-5-5')).toBe('high')
  expect(effortFromSettings(settings, 'claude-opus-5-5')).toBe('low')
  expect(effortFromSettings({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'max' } } }, 'claude-opus-5-5[1m]')).toBe('max') // [1m] is not part of the key
  expect(effortFromSettings({ modelSettings: { x: { effortLevel: 5 } }, effortLevel: 7 }, 'x')).toBe(null) // only a level's name counts
  expect([effortFromSettings(null, 'x'), effortFromSettings('junk', null), effortFromSettings({}, 'x')]).toEqual([null, null, null])
})

test('an ai-sdlc value of another shape reads as none rather than breaking the drawing', () => {
  const current = { activeId: null, tier: null, stages: null, next: null, build: null }
  expect(normalizeSdlc(current)).toEqual(current)
  expect([normalizeSdlc(null), normalizeSdlc('junk'), normalizeSdlc({}), normalizeSdlc([])]).toEqual([null, null, null, null])
})

test('the options are read leniently: anything malformed falls back to the default', () => {
  expect(parseConfig({})).toEqual({ palette: 'theme', openOnStart: true })
  expect(parseConfig({ palette: 'pastel', openOnStart: false })).toEqual({ palette: 'pastel', openOnStart: false })
  expect(parseConfig({ palette: 'neon', openOnStart: 'no' })).toEqual({ palette: 'theme', openOnStart: true })
})
