// The desktop band's pictures as SVG markup: the eight-step progress line and the small bars. Pure: colours come in as hex
// (an SVG drawn as an image cannot name theme keys), and what comes out is a string and its size.
import type { Stage, StageState } from '../types'
import { STAGES } from './sdlc'

export type Drawing = { source: string; width: number; height: number }

export type StepperColors = { done: string; current: string; grey: string }

const R = 6.5 // a mark's radius
const GAP = 28 // from one mark's centre to the next
const PAD = 11 // from the edge to the first mark's centre, room for the current mark's halo
const HEIGHT = 24

/** One step's mark, centred at (x, cy): a ticked disc, a ringed dot with a halo, a dashed ring, or an open ring. */
const markShapes = (state: StageState, x: number, cy: number, colors: StepperColors) =>
  state === 'done'
    ? `<circle cx="${x}" cy="${cy}" r="${R}" fill="${colors.done}"/><path d="M${x - 3} ${cy + 0.2} l2.2 2.3 l4-4.8" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : state === 'current'
      ? `<circle cx="${x}" cy="${cy}" r="${R + 3.5}" fill="${colors.current}" fill-opacity="0.22"/><circle cx="${x}" cy="${cy}" r="${R}" fill="none" stroke="${colors.current}" stroke-width="2.2"/><circle cx="${x}" cy="${cy}" r="2.6" fill="${colors.current}"/>`
      : state === 'skipped'
        ? `<circle cx="${x}" cy="${cy}" r="${R}" fill="none" stroke="${colors.grey}" stroke-opacity="0.7" stroke-width="1.6" stroke-dasharray="2.6 2.6"/><line x1="${x - 3}" y1="${cy}" x2="${x + 3}" y2="${cy}" stroke="${colors.grey}" stroke-opacity="0.7" stroke-width="1.6" stroke-linecap="round"/>`
        : `<circle cx="${x}" cy="${cy}" r="${R}" fill="none" stroke="${colors.grey}" stroke-opacity="0.75" stroke-width="1.8"/>`

/**
 * The pipeline as one line of marks joined by lines: a ticked disc for a step done, a ringed dot with a soft halo for the step
 * now, an open ring for a step to come and a dashed ring for a skipped one. The lines are lit up to the furthest step reached.
 */
export const stepperSvg = (stages: Record<Stage, StageState>, colors: StepperColors): Drawing => {
  const n = STAGES.length
  const width = 2 * PAD + (n - 1) * GAP
  const cy = HEIGHT / 2
  const reached = Math.max(-1, ...STAGES.map((s, i) => (stages[s] === 'done' || stages[s] === 'current' ? i : -1)))
  const parts = STAGES.map((stage, i) => {
    const x = PAD + i * GAP
    const state = stages[stage]
    const line =
      i < n - 1
        ? `<line x1="${x + R + 2.5}" y1="${cy}" x2="${x + GAP - R - 2.5}" y2="${cy}" stroke="${i + 1 <= reached ? colors.done : colors.grey}" stroke-opacity="${i + 1 <= reached ? 1 : 0.4}" stroke-width="2" stroke-linecap="round"/>`
        : ''
    const mark = markShapes(state, x, cy, colors)
    return line + mark
  }).join('')
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${parts}</svg>`, width, height: HEIGHT }
}

/** A thin rounded bar filled to `fraction` (0 to 1) over a faint track: a gauge, or the build's progress. */
export const barSvg = (fraction: number, fill: string, track: string, width = 44, height = 6): Drawing => {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const r = height / 2
  // a bar with anything in it shows at least a dot, so a small value is not mistaken for none
  const filled = f === 0 ? 0 : Math.max(height, Math.round(f * width * 10) / 10)
  const bar = filled > 0 ? `<rect width="${filled}" height="${height}" rx="${r}" fill="${fill}"/>` : ''
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${r}" fill="${track}" fill-opacity="0.3"/>${bar}</svg>`,
    width,
    height,
  }
}
