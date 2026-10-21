// The helpers for the model and limit rows, from claude-flightdeck (MIT, see NOTICE), in the style of the author's statusline: the model
// with its effort, the context and the 5h and 7d limits, and the spend. Every value that could not be read is null and is drawn as N/A.
import type { Main, Status, Usage } from '../types'
import type { Els } from './board'
import { prettyModel } from './core'
import type { Colors } from './core'
import { NA } from './statusline'
import type { Tone } from './statusline'

export type MainProps = { els: Els; C: Colors; main: Main; usage: Usage; status: Status; now: number }

/** Calm to 50, orange past it, red from 80: the scale of the author's statusline. */
export const toneColor = (C: Colors, tone: Tone) => (tone === 'red' ? C.red : tone === 'orange' ? C.folder : C.git)

/** The limit window whose kind reads as `five` or `seven` (`five_hour`, `seven_day`). */
export const windowOf = (usage: Usage, word: 'five' | 'seven') => usage.limits.find(l => l.kind.toLowerCase().includes(word)) ?? null

export const modelOf = (main: Main) => (main.model ? prettyModel(main.model) : NA)
