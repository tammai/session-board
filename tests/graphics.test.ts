import { expect, test } from 'claude-code/testing'

import { barSvg, stepperSvg } from '../hooks/graphics'
import type { Stage, StageState } from '../types'

const COLORS = { done: '#00ff00', current: '#ff8800', grey: '#888888' }
const stages = (states: StageState[]) => Object.fromEntries((['intent', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'knowledge'] as Stage[]).map((s, i) => [s, states[i]])) as Record<Stage, StageState>
const count = (text: string, part: string) => text.split(part).length - 1

test('the pipeline drawing has a mark per step in the state it is in, and lit lines up to the furthest step reached', () => {
  const d = stepperSvg(stages(['done', 'skipped', 'done', 'current', 'todo', 'todo', 'todo', 'todo']), COLORS)
  expect(d.source.startsWith('<svg ')).toBe(true)
  expect(d.source).toContain(`width="${d.width}" height="${d.height}"`)
  expect(count(d.source, '<path')).toBe(2) // a tick in each done disc
  expect(count(d.source, 'stroke-dasharray')).toBe(1) // the skipped ring is dashed
  expect(count(d.source, `fill-opacity="0.22"`)).toBe(1) // the step now has a halo
  expect(count(d.source, '<line')).toBe(7 + 1) // a line between each pair, and the dash inside the skipped ring
  // the lines up to the step now are lit in the done colour; the rest are faint grey
  expect(count(d.source, `stroke="${COLORS.done}" stroke-opacity="1"`)).toBe(3)
  expect(count(d.source, `stroke="${COLORS.grey}" stroke-opacity="0.4"`)).toBe(4)
})

test('a change with nothing reached has no lit line; a finished one has them all lit', () => {
  const none = stepperSvg(stages(Array<StageState>(8).fill('todo')), COLORS).source
  expect(count(none, `stroke-opacity="1"`)).toBe(0)
  const all = stepperSvg(stages(Array<StageState>(8).fill('done')), COLORS).source
  expect(count(all, `stroke="${COLORS.done}" stroke-opacity="1"`)).toBe(7)
  expect(count(all, '<path')).toBe(8)
})

test('a bar is filled to its fraction, clamped, with at least a dot for any value and nothing for none', () => {
  const rects = (fraction: number) => [...barSvg(fraction, '#0f0', '#888').source.matchAll(/<rect width="([\d.]+)"/g)].map(m => Number(m[1]))
  expect(rects(0.5)).toEqual([44, 22]) // the track, then the fill
  expect(rects(2)).toEqual([44, 44]) // clamped to full
  expect(rects(-1)).toEqual([44]) // nothing
  expect(rects(Number.NaN)).toEqual([44])
  expect(rects(0.01)).toEqual([44, 6]) // a small value still shows a dot, as wide as the bar is high
})
