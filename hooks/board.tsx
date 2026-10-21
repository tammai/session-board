// The band's drawing: the AI-SDLC line in the terminal's glyphs and the box round it, and the two-row card where SVG is drawn (desktop.tsx).
// Every value that could not be read is null and is drawn as N/A.
import type { EngineInterface } from 'claude-code'

import type { Sdlc, StageState } from '../types'
import { widthOf } from './core'
import type { Colors } from './core'
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
 * The terminal's band, the desktop's line in glyphs: AI-SDLC, the step now, the tier and the change, each after a dot (the change is
 * cut at the edge), then the eight steps as a progress line (marks joined by lines, lit up to the current step) and the build's
 * count (the steps that passed, green, out of all of them; a single step has nothing to count). A closed change has no step now:
 * its outcome follows the change. No ai-sdlc files, no line.
 */
export const progressLine = ({ els, C, sdlc }: { els: Els; C: Colors; sdlc: Sdlc }) => {
  const { Box, Text } = els
  const stages = sdlc.stages
  const title = (
    <Text key="title" bold color={C.border}>
      AI-SDLC
    </Text>
  )
  const dot = (i: number) => (
    <Text key={`dot-${i}`} color={C.dim}>
      {' · '}
    </Text>
  )
  if (!sdlc.activeId || !stages) {
    return (
      <Box key="band-panel">
        <Text wrap="truncate">
          {title}
          <Text color={C.dim}>{sdlc.activeId ? ` stages ${NA}` : ' no active change'}</Text>
        </Text>
      </Box>
    )
  }
  const { now } = nowNext(stages)
  const links = stageLinks(stages)
  const total = sdlc.build?.length ?? 0
  const passed = sdlc.build?.filter(r => r.verdict === 'pass').length ?? 0
  const parts = [
    title,
    ...(now ? [lit(els, C.folder, LABELS[now], 'now')] : []),
    <Text key="tier">
      <Text color={C.dim}>Tier </Text>
      {lit(els, C.border, (sdlc.tier ?? NA).toUpperCase(), 'tier')}
    </Text>,
    <Text key="change" color={C.dim}>
      {sdlc.activeId}
      {now ? '' : ` ${(sdlc.next ?? 'closed').replace(/^./, c => c.toUpperCase())}`}
    </Text>,
  ]
  return (
    <Box key="band-panel" justifyContent="space-between" columnGap={2}>
      <Text wrap="truncate">{parts.flatMap((part, i) => (i === 0 ? [part] : [dot(i), part]))}</Text>
      <Text>
        {STAGES.flatMap((stage, i) => [
          <Text key={`mark-${stage}`} bold={stages[stage] === 'current'} color={stages[stage] === 'done' ? C.git : stages[stage] === 'current' ? C.folder : C.dim}>
            {GLYPH[stages[stage]]}
          </Text>,
          ...(i < STAGES.length - 1 ? [<Text key={`link-${stage}`} color={links[i] ? C.git : C.dim}>─</Text>] : []),
        ])}
        {total > 1 ? [<Text key="gap">{'  '}</Text>, lit(els, C.git, String(passed), 'done'), <Text key="of" color={C.dim}>{`/${total}`}</Text>] : null}
      </Text>
    </Box>
  )
}

export type BandProps = MainProps & { sdlc: Sdlc | null; W: number; surface: string; onClose?: () => void }

/**
 * The band: on the desktop app the AI-SDLC line alone, in the host's frame; in the terminal the same line in glyphs, in an orange
 * border; in the editor and on the phones a two-row card. The caller leaves the surface to the engine where there is nothing to show.
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
      {p.sdlc ? progressLine({ els: p.els, C: p.C, sdlc: p.sdlc }) : null}
    </Box>
  )
}
