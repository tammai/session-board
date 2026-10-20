// The band's first line, from claude-flightdeck (MIT, see NOTICE), in the style of the author's statusline: working or idle, the
// model with its effort, the context and the 5h and 7d limits, and the spend. Every value that could not be read is null and
// is drawn as N/A.
import type { Main, Status, Usage } from '../types'
import type { Els } from './board'
import { prettyModel } from './core'
import type { Colors } from './core'
import { NA, money, pctText, toneOf, untilReset } from './statusline'
import type { Tone } from './statusline'

export type MainProps = { els: Els; C: Colors; main: Main; usage: Usage; status: Status; now: number; w: number }

/** Calm to 50, orange past it, red from 80: the scale of the author's statusline. */
export const toneColor = (C: Colors, tone: Tone) => (tone === 'red' ? C.red : tone === 'orange' ? C.folder : C.git)

/** The limit window whose kind reads as `five` or `seven` (`five_hour`, `seven_day`). */
export const windowOf = (usage: Usage, word: 'five' | 'seven') => usage.limits.find(l => l.kind.toLowerCase().includes(word)) ?? null

export const modelOf = (main: Main) => (main.model ? prettyModel(main.model) : NA)

/**
 * Working or idle, the model with its effort, the context, the 5h and 7d limits
 * (percents only) and `$session/$project` spend, separated by small dots.
 */
export const mainLine = ({ els, C, main, usage, status, now }: Omit<MainProps, 'w'>) => {
  const { Box, Text } = els
  const five = windowOf(usage, 'five')
  const seven = windowOf(usage, 'seven')
  // a limit also carries the time to its reset, in grey, when it has one
  const pct = (label: string, value: number | null, window: ReturnType<typeof windowOf> = null) => {
    const reset = window ? untilReset(window.resetsAt, now) : NA
    return {
      text: `${label} ${pctText(value)}`,
      color: value === null ? C.dim : toneColor(C, toneOf(value)),
      tail: reset === NA ? null : ` ${reset}`,
    }
  }
  const pieces = [
    { text: main.isRunning ? '● working' : '○ idle', color: main.isRunning ? C.main : C.dim },
    { text: `${modelOf(main)} ${main.effort ?? NA}`, color: C.bold, bold: true },
    pct('ctx', usage.pct),
    pct('5h', five ? five.pct : null, five),
    pct('7d', seven ? seven.pct : null, seven),
    { text: `${money(usage.costUsd)}/${money(status.projectCost)}`, color: C.bold, bold: true },
  ]
  return (
    <Box key="band-main">
      <Text wrap="truncate">
        {pieces.flatMap((p, i) => [
          ...(i > 0 ? [<Text key={`dot-${i}`} color={C.dim}>{' · '}</Text>] : []),
          <Text key={`piece-${i}`} color={p.color} bold={'bold' in p && p.bold === true}>
            {p.text}
          </Text>,
          ...('tail' in p && p.tail ? [<Text key={`tail-${i}`} color={C.dim}>{p.tail}</Text>] : []),
        ])}
      </Text>
    </Box>
  )
}
