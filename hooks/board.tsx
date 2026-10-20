// The board's drawing: the AI-SDLC card and the compact band. The main, agents and gate panels are in main.tsx
// and panels.tsx. Every value that could not be read is null and is drawn as N/A.
import type { EngineInterface } from 'claude-code'

import type { ChecklistItem, Sdlc, Stage, StageState } from '../types'
import { clean, shorten, widthOf } from './core'
import type { Colors } from './core'
import { mainLine } from './main'
import type { MainProps } from './main'
import { rule } from './rule'
import { nowNext, stageLinks } from './sdlc'
import { NA } from './statusline'

export type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * Text cut to `n` columns on the terminal, where a character is a column. Elsewhere the font is proportional, so a count of
 * characters says nothing of the width: the whole text goes on, in a `wrap="truncate"` Text, and the host cuts it at the real edge.
 */
const fit = (text: string, n: number, surface: string) => (surface === 'terminal' ? shorten(text, n) : clean(text))

// ---------------------------------------------------------------- AI-SDLC

/** The board's heading, centred over the panels: the project's name, a dot, then `$session/$project` spend. */
export const boardTitle = ({ els, C, name, cost }: { els: Els; C: Colors; name: string; cost: string }) => {
  const { Box, Text } = els
  return (
    <Box key="board-title" justifyContent="center">
      <Text wrap="truncate">
        <Text bold color={C.main}>
          {name.toUpperCase()}
        </Text>
        <Text color={C.dim}>{' · '}</Text>
        <Text bold color={C.bold}>
          {cost}
        </Text>
      </Text>
    </Box>
  )
}

/** `now Review · next Ship`: the step in progress and the one after it; null when nothing is in progress. */
const nowNextText = (stages: Record<Stage, StageState>) => {
  const { now, next } = nowNext(stages)
  return now ? `now ${LABELS[now]}${next ? ` · next ${LABELS[next]}` : ''}` : null
}

/**
 * The compact band's second line, titled AI-SDLC: the eight steps as a progress line (marks joined by lines, lit up to the current
 * step), then the step now and the step next (a skipped step is not next). A closed change says so.
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
  const tail = nowNextText(stages) ?? 'closed'
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
        <Text color={C.text}>{tail}</Text>
      </Text>
    </Box>
  )
}

export type BandProps = Omit<MainProps, 'w'> & { sdlc: Sdlc | null; W: number; surface: string }

/**
 * The compact band, in an orange border: the main line, and the progress line (none where the project has no
 * ai-sdlc files).
 */
export const bandRow = (p: BandProps) => {
  const { Box } = p.els
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={p.C.main} paddingX={1} width={widthOf(p.surface, p.W)}>
      {mainLine(p)}
      {p.sdlc ? progressLine({ els: p.els, C: p.C, sdlc: p.sdlc }) : null}
    </Box>
  )
}

export type SdlcProps = { els: Els; C: Colors; sdlc: Sdlc; W: number; surface: string }

const STAGES: Stage[] = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'ship', 'knowledge']
const LABELS: Record<Stage, string> = { intent: 'Intent', spec: 'Spec', plan: 'Plan', build: 'Build', verify: 'Verify', review: 'Review', ship: 'Ship', knowledge: 'Knowledge' }
// done, now, still to come, skipped
const GLYPH: Record<StageState, string> = { done: '✔', current: '◉', todo: '○', skipped: '⊖' }

// The same colours as hex, for the SVG, which cannot name theme keys.
const SVG = { done: '#59c9a5', current: '#f07623', grey: '#8b93a1', label: '#9aa5b1' }

type StepperProps = { els: Els; C: Colors; stages: Record<Stage, StageState>; W: number; surface: string }

/** The pipeline as a progress line: a mark per step joined by lines, lit up to the current step, with the labels under. */
const stepper = ({ els, C, stages, W, surface }: StepperProps) => {
  const links = stageLinks(stages)
  // The terminal draws glyphs; the other surfaces draw the SVG (`'Svg' in els` cannot tell them apart).
  if (surface !== 'terminal' && 'Svg' in els) {
    const { Box, Svg } = els
    // sized to the pane (about 8.5 px a column), not a fixed 520 that the host would shrink; too narrow for every name,
    // it names the current step in full and the others by their first letter, as on the terminal
    const pxW = Math.min(640, Math.max(160, Math.floor((W - 4) * 8.5)))
    const isNarrowPx = pxW / STAGES.length < 66
    const currentStage = STAGES.find(st => stages[st] === 'current') ?? null
    const currentX = currentStage ? (pxW / STAGES.length) * (STAGES.indexOf(currentStage) + 0.5) : -1000
    const currentHalf = currentStage ? LABELS[currentStage].length * 3.4 + 6 : 0
    const pxH = 76
    const col = pxW / STAGES.length
    const r = 11
    const y = 20
    const parts = STAGES.map((stage, i) => {
      const x = col * (i + 0.5)
      const state = stages[stage]
      const line = i < STAGES.length - 1 ? `<line x1="${x + r + 3}" y1="${y}" x2="${x + col - r - 3}" y2="${y}" stroke="${links[i] ? SVG.done : SVG.grey}" stroke-width="3"/>` : ''
      const mark =
        state === 'done'
          ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${SVG.done}"/><path d="M${x - 5} ${y} l4 4 l7 -8" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
          : state === 'skipped'
            ? `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${SVG.grey}" stroke-width="2" stroke-dasharray="3 3"/><line x1="${x - 5}" y1="${y}" x2="${x + 5}" y2="${y}" stroke="${SVG.grey}" stroke-width="2"/>`
            : state === 'current'
              ? `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${SVG.current}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="4" fill="${SVG.current}"/>`
              : `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${SVG.grey}" stroke-width="2.5"/>`
      const isCurrent = state === 'current'
      const name = isNarrowPx && !isCurrent ? LABELS[stage].slice(0, 1) : LABELS[stage]
      // a first letter that would fall under the current step's full name is left out
      const isHidden = isNarrowPx && !isCurrent && Math.abs(x - currentX) < currentHalf + 6
      const label = isHidden ? '' : `<text x="${isNarrowPx && isCurrent ? Math.min(Math.max(x, LABELS[stage].length * 3.4), pxW - LABELS[stage].length * 3.4) : x}" y="58" font-size="12" text-anchor="middle" fill="${isCurrent ? SVG.current : SVG.label}"${isCurrent ? ' font-weight="bold"' : ''}>${name}</text>`
      return line + mark + label
    }).join('')
    return (
      <Box key="stage-svg">
        <Svg
          source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">${parts}</svg>`}
          alt={STAGES.map(s => `${LABELS[s]} ${stages[s]}`).join(', ')}
          width={pxW}
          height={pxH}
        />
      </Box>
    )
  }
  const { Box, Text } = els
  // each step gets a cell: the mark in the middle, a line on each side where the neighbour is joined
  const cell = Math.max(3, Math.floor((W - 4) / STAGES.length))
  const left = Math.floor((cell - 1) / 2)
  const right = cell - 1 - left
  const markColor = (s: StageState) => (s === 'done' ? C.git : s === 'current' ? C.folder : C.dim)
  const last = STAGES.length - 1
  const inner = W - 4
  const isNarrow = cell < Math.max(...STAGES.map(st => LABELS[st].length))
  const current = STAGES.find(st => stages[st] === 'current') ?? null
  // the full name is centred on the current mark, kept inside the row
  const nameAt = current ? Math.min(Math.max(0, cell * STAGES.indexOf(current) + left - Math.floor(LABELS[current].length / 2)), Math.max(0, inner - LABELS[current].length)) : 0
  const nameEnd = current ? nameAt + LABELS[current].length : 0
  const pieces = STAGES.map((stage, i) => ({ col: cell * i + left, text: stage === current ? LABELS[stage] : LABELS[stage].slice(0, 1), isCurrent: stage === current }))
    .map(p => (p.isCurrent ? { ...p, col: nameAt } : p))
    .filter(p => p.isCurrent || !current || p.col < nameAt || p.col >= nameEnd)
  let cursor = 0
  const narrowLabels = pieces.map(p => {
    const pad = Math.max(0, p.col - cursor)
    cursor = cursor + pad + p.text.length
    return { text: p.text, pad, isCurrent: p.isCurrent }
  })
  return (
    <Box flexDirection="column">
      <Box key="stage-icons">
        {STAGES.map((stage, i) => (
          <Box key={`mark-${stage}`}>
            <Text color={i > 0 && links[i - 1] ? C.git : C.dim}>{(i === 0 ? ' ' : '─').repeat(left)}</Text>
            <Text bold={stages[stage] === 'current'} color={markColor(stages[stage])}>
              {GLYPH[stages[stage]]}
            </Text>
            <Text color={i < last && links[i] ? C.git : C.dim}>{(i === last ? ' ' : '─').repeat(right)}</Text>
          </Box>
        ))}
      </Box>
      {isNarrow ? (
        // too narrow for every name: the step in progress is named in full, centred under its mark, and each
        // other step by its first letter under its own mark (a letter that falls under the full name is dropped)
        <Box key="stage-labels">
          {narrowLabels.map((piece, i) => (
            <Text key={`piece-${i}`} bold={piece.isCurrent} color={piece.isCurrent ? C.folder : C.dim}>
              {' '.repeat(piece.pad) + piece.text}
            </Text>
          ))}
        </Box>
      ) : (
        <Box key="stage-labels">
          {STAGES.map(stage => {
            const name = LABELS[stage]
            const pad = Math.floor((cell - name.length) / 2)
            return (
              <Text key={`label-${stage}`} bold={stages[stage] === 'current'} color={stages[stage] === 'current' ? C.folder : C.dim}>
                {' '.repeat(pad) + name + ' '.repeat(cell - pad - name.length)}
              </Text>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

/** The AI-SDLC card: the active change's stepper and build rounds, the metrics, recent changes and the backlog. */
export const sdlcPanel = ({ els, C, sdlc, W, surface }: SdlcProps) => {
  const { Box, Text } = els
  // [>] being worked on, [ ] still to come, [x] finished
  const item = (i: ChecklistItem) => {
    const mark = i.state === 'working' ? '[>]' : i.state === 'pending' ? '[ ]' : '[x]'
    // a done row has no note after its id: the id gets the whole row, less the border, padding and mark
    const id = fit(i.id, i.state === 'done' ? W - 8 : Math.max(16, W - 24), surface)
    const text = i.state === 'working' ? `${mark} ${id} · ${i.note ?? NA}` : i.state === 'pending' ? `${mark} ${id} ${fit(i.note ?? '', Math.max(8, W - 12 - id.length), surface)}` : `${mark} ${id}`
    return (
      <Text key={`check-${i.state}-${i.id}`} wrap="truncate" color={i.state === 'working' ? C.folder : undefined} dimColor={i.state === 'done'}>
        {text}
      </Text>
    )
  }
  const active = sdlc.activeId
  return (
    <Box key="sdlc-box" flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1} width={widthOf(surface, W)}>
      <Box justifyContent="space-between">
        <Text bold color={C.border}>
          AI-SDLC
        </Text>
        {active ? <Text color={C.dim}>{`tier ${sdlc.tier ?? NA}`}</Text> : null}
      </Box>
      {active ? (
        <Box flexDirection="column">
          <Text wrap="truncate">{fit(active, W - 4, surface)}</Text>
          <Box key="stage-block" flexDirection="column" marginTop={surface === 'terminal' ? 0 : 1}>
            {sdlc.stages ? stepper({ els, C, stages: sdlc.stages, W, surface }) : <Text color={C.dim}>{`stages ${NA}`}</Text>}
          </Box>
          <Box key="status-block" flexDirection="column" marginTop={surface === 'terminal' ? 0 : 1}>
          {/* the step now and the step next, as in the band; a closed change says how it closed */}
          <Text color={C.text}>{(sdlc.stages ? nowNextText(sdlc.stages) : null) ?? sdlc.next ?? NA}</Text>
          {sdlc.isDirty === true ? <Text color={C.amber}>unverified edits</Text> : null}
          {sdlc.isDirty === null ? <Text color={C.dim}>{`edits ${NA}`}</Text> : null}
          {sdlc.build === null ? <Text color={C.dim}>{`build ${NA}`}</Text> : null}
          {sdlc.build?.length === 0 ? <Text color={C.dim}>no build rounds yet</Text> : null}
          {sdlc.build?.map(r => (
            <Text key={`build-${r.step}`} wrap="truncate">{`${r.step} ${r.rounds}/${sdlc.maxRounds} ${r.verdict ?? '–'} ${r.model || '–'}`}</Text>
          ))}
          {sdlc.implementers?.map(i => (
            <Text key={`impl-${i.agent}-${i.model}`} color={C.dim} wrap="truncate">{`implementer ${i.agent} (${i.model})`}</Text>
          ))}
          </Box>
        </Box>
      ) : (
        <Text color={C.dim}>no active change</Text>
      )}
      {sdlc.checklist.length > 0 || !sdlc.isPendingKnown ? (
        <Box key="checklist-gap">
          <Text> </Text>
        </Box>
      ) : null}
      {sdlc.checklist.length > 0 || !sdlc.isPendingKnown ? (
        <Box key="checklist" flexDirection="column">
          <Box key="checklist-head" columnGap={1}>
            <Text color={C.white}>Tasks</Text>
            {/* a line runs on from the title across the rest of the row: inner width less the border, padding, title and gap */}
            {rule({ els, color: C.border, hex: '#87ceeb', cells: W - 4 - 'Tasks'.length - 1, surface })}
          </Box>
          {sdlc.checklist
            .filter(i => i.state === 'working')
            .map(i => item(i))}
          {sdlc.isPendingKnown ? sdlc.checklist.filter(i => i.state === 'pending').map(i => item(i)) : <Text color={C.dim}>{`pending ${NA}`}</Text>}
          {sdlc.checklist
            .filter(i => i.state === 'done')
            .map(i => item(i))}
        </Box>
      ) : null}
    </Box>
  )
}
