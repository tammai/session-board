// The band's drawing: the AI-SDLC line and the box round it and the main line (main.tsx). Every value that could not be
// read is null and is drawn as N/A.
import type { EngineInterface } from 'claude-code'

import type { Sdlc, StageState } from '../types'
import { widthOf } from './core'
import type { Colors } from './core'
import { mainLine } from './main'
import type { MainProps } from './main'
import { desktopPanel, desktopRows } from './desktop'
import { LABELS, STAGES, nowNext, stageLinks } from './sdlc'
import { NA } from './statusline'

export type Els = ReturnType<EngineInterface['ui']['resolve']>

// done, now, still to come, skipped
const GLYPH: Record<StageState, string> = { done: '✔', current: '◉', todo: '○', skipped: '⊖' }

/** A coloured piece of a line. */
const lit = (els: Els, color: string, text: string, key: string) => {
  const { Text } = els
  return (
    <Text key={key} color={color}>
      {text}
    </Text>
  )
}

/**
 * `now Review · next Ship · done 9/10`, as the pieces of one Text: the step in progress (orange, like its mark) and the one after it
 * (sky blue, a skipped step never next), then the build's count (the steps that passed, green, out of all of them; a single step has
 * nothing to count). `fallback` stands for the step now when nothing is in progress: how a closed change closed.
 */
const statusParts = ({ els, C, sdlc, fallback }: { els: Els; C: Colors; sdlc: Sdlc; fallback: string }) => {
  const { now, next } = sdlc.stages ? nowNext(sdlc.stages) : { now: null, next: null }
  return [
    ...(now ? ['now ', lit(els, C.folder, LABELS[now], 'now'), ...(next ? [' · next ', lit(els, C.border, LABELS[next], 'next')] : [])] : [fallback]),
    ...(sdlc.build && sdlc.build.length > 1 ? [' · done ', lit(els, C.git, String(sdlc.build.filter(r => r.verdict === 'pass').length), 'done'), `/${sdlc.build.length}`] : []),
  ]
}

/**
 * The compact band's second line, titled AI-SDLC: the eight steps as a progress line (marks joined by lines, lit up to the current
 * step), then the step now and the step next with the build's count, the change and the tier, each after a dot. A closed change says
 * so. What does not fit is cut from the right.
 */
export const progressLine = ({ els, C, sdlc }: { els: Els; C: Colors; sdlc: Sdlc }) => {
  const { Box, Text } = els
  const stages = sdlc.stages
  if (!sdlc.activeId || !stages) {
    return (
      <Box key="band-progress">
        <Text color={C.dim}>{sdlc.activeId ? `AI-SDLC stages ${NA}` : 'AI-SDLC no active change'}</Text>
      </Box>
    )
  }
  const links = stageLinks(stages)
  return (
    <Box key="band-progress">
      <Text wrap="truncate">
        <Text bold color={C.border}>
          AI-SDLC
        </Text>
        <Text> </Text>
        {STAGES.flatMap((stage, i) => [
          <Text key={`mark-${stage}`} bold={stages[stage] === 'current'} color={stages[stage] === 'done' ? C.git : stages[stage] === 'current' ? C.folder : C.dim}>
            {GLYPH[stages[stage]]}
          </Text>,
          ...(i < STAGES.length - 1 ? [<Text key={`link-${stage}`} color={links[i] ? C.git : C.dim}>─</Text>] : []),
        ])}
        <Text color={C.dim}>{'  '}</Text>
        <Text color={C.text}>{statusParts({ els, C, sdlc, fallback: 'closed' })}</Text>
        <Text color={C.dim}>{` · ${sdlc.activeId} · tier `}</Text>
        {lit(els, C.border, sdlc.tier ?? NA, 'tier')}
      </Text>
    </Box>
  )
}

export type BandProps = Omit<MainProps, 'w'> & { sdlc: Sdlc | null; W: number; surface: string; onClose?: () => void }

/**
 * The compact band, in an orange border: the main line, and the progress line (none where the project has no
 * ai-sdlc files).
 */
export const bandRow = (p: BandProps) => {
  const { Box } = p.els
  // The desktop app draws the AI-SDLC row alone, in the host's frame with its close control.
  const panel = p.surface === 'desktop' && p.onClose ? desktopPanel({ ...p, onClose: p.onClose }) : null
  if (panel) return panel
  // Where else the surface draws SVG (the editor, the phones) the band is a card of two rows; the terminal draws glyphs.
  const rows = p.surface === 'terminal' ? null : desktopRows(p)
  if (rows) {
    return (
      <Box flexDirection="column" rowGap="xs" borderStyle="round" borderColor={p.C.main} paddingX={1} width={widthOf(p.surface, p.W)}>
        {rows}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.C.main} paddingX={1} width={widthOf(p.surface, p.W)}>
      {mainLine(p)}
      {p.sdlc ? progressLine({ els: p.els, C: p.C, sdlc: p.sdlc }) : null}
    </Box>
  )
}
