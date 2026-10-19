// The main panel, from claude-flightdeck (MIT, see NOTICE), in the style of the author's statusline: the model with
// its effort, and whether it is working; the context and the 5h and 7d limits as one row of gauges;
// and the git branch with its lines added and removed. Every value that could not be read is null and is drawn as N/A.
import type { Main, Status, Usage } from '../types'
import type { Els } from './board'
import { rule } from './rule'
import { clean, prettyModel, widthOf } from './core'
import type { Colors } from './core'
import { NA, cellsOf, money, pctText, shortBranch, toneOf, untilReset } from './statusline'
import type { Tone } from './statusline'

export type MainProps = { els: Els; C: Colors; main: Main; usage: Usage; status: Status; now: number; w: number }

/** Calm to 50, orange past it, red from 80: the scale of the author's statusline. */
const toneColor = (C: Colors, tone: Tone) => (tone === 'red' ? C.red : tone === 'orange' ? C.folder : C.git)

/** The limit window whose kind reads as `five` or `seven` (`five_hour`, `seven_day`). */
const windowOf = (usage: Usage, word: 'five' | 'seven') => usage.limits.find(l => l.kind.toLowerCase().includes(word)) ?? null

const modelOf = (main: Main) => (main.model ? prettyModel(main.model) : NA)

export const mainPanel = ({ els, C, main, usage, status, now, w, surface }: MainProps & { surface: string }) => {
  const { Box, Text } = els
  // A gauge as the statusline draws it: a bold white label, five block cells in the tone, a bold percentage,
  // then what goes with it in grey (the time to a reset, the tokens) and a note in amber (compactions).
  const gauge = (key: string, label: string, pct: number | null, tail: string | null = null, note: string | null = null) => {
    if (pct === null) {
      return (
        <Text key={key}>
          <Text bold color={C.bold}>{`${label} `}</Text>
          <Text dimColor>{NA}</Text>
        </Text>
      )
    }
    const cells = cellsOf(pct, 5)
    const tone = toneColor(C, toneOf(pct))
    return (
      <Text key={key}>
        <Text bold color={C.bold}>{`${label} `}</Text>
        <Text color={tone}>{'█'.repeat(cells.on)}</Text>
        <Text color={C.faint}>{'░'.repeat(cells.off)}</Text>
        <Text bold color={tone}>{` ${pctText(pct)}`}</Text>
        {tail ? <Text color={C.dim}>{` ${tail}`}</Text> : null}
        {note ? <Text color={C.amber}>{`  ${note}`}</Text> : null}
      </Text>
    )
  }
  // The time to each reset where the line has room for it.
  const resetOf = (window: ReturnType<typeof windowOf>) => {
    const reset = window && w >= 56 ? untilReset(window.resetsAt, now) : NA
    return reset === NA ? null : reset
  }
  const five = windowOf(usage, 'five')
  const seven = windowOf(usage, 'seven')
  const dirty = status.dirty !== null && status.dirty > 0
  const gitColor = status.branch === null ? C.dim : dirty ? C.dirty : C.git
  // The changes sit at the right edge; the branch name takes the room that is left, less a gap and the chip's glyph and its three spaces.
  const changesLength = status.added === null || status.removed === null ? NA.length : `+${status.added} -${status.removed}`.length
  const branchRoom = Math.max(6, w - 4 - changesLength - 1 - 4)
  const branchName = status.branch === null ? NA : surface === 'terminal' ? shortBranch(status.branch, branchRoom) : clean(status.branch)
  const dot = (key: string) => (
    <Text key={key} color={C.dim}>
      {' · '}
    </Text>
  )
  return (
    <Box key="main-box" flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={widthOf(surface, w)}>
      <Box key="main-title" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={C.main} bold>
            {modelOf(main)}
          </Text>
          <Text color={C.dim}>{` ${main.effort ?? NA}`}</Text>
        </Text>
        <Text color={main.isRunning ? C.main : C.dim}>{main.isRunning ? '● working' : '○ idle'}</Text>
      </Box>
      <Box key="main-limits">
        <Text>
          {gauge('ctx', 'ctx', usage.pct, null, usage.pct !== null && usage.compactions > 0 ? `⟲${usage.compactions}` : null)}
          {dot('dot-1')}
          {gauge('5h', '5h', five ? five.pct : null, resetOf(five))}
          {dot('dot-2')}
          {gauge('7d', '7d', seven ? seven.pct : null, resetOf(seven))}
        </Text>
      </Box>
      {/* a line between the gauges and the branch: the panel's inner width, less its border and padding */}
      <Box key="main-rule">{rule({ els, color: C.faint, hex: '#8b93a1', cells: w - 4, surface })}</Box>
      <Box key="main-git" justifyContent="space-between" columnGap={1}>
        {/* the chip may shrink: on the terminal the name is cut to the room that is left; elsewhere the host cuts it at the real edge */}
        <Box flexShrink={1} minWidth={0}>
          <Text color={C.ink} backgroundColor={gitColor} wrap="truncate">{` ⎇ ${branchName} `}</Text>
        </Box>
        <Box flexShrink={0} columnGap={1}>
          {status.added === null || status.removed === null ? <Text color={C.dim}>{NA}</Text> : null}
          {status.added !== null && status.removed !== null ? <Text color={C.git}>{`+${status.added}`}</Text> : null}
          {status.added !== null && status.removed !== null ? <Text color={C.red}>{`-${status.removed}`}</Text> : null}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * The compact band's first line: working or idle, the model with its effort, the context, the 5h and 7d limits
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
