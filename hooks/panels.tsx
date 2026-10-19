// The Agents and Gate panels, ported from claude-flightdeck (MIT, see NOTICE). Each takes already-read data
// and callbacks; none touches `$`.
import type { AgentCard, Bucket, Check, Gate } from '../types'
import type { Els } from './board'
import { SVG_COLORS, cardTitle, fmtTimer, gateSummary, kTokens, lanes, prettyModel, shorten, titleLines, widthOf } from './core'
import type { Colors } from './core'

// ---------------------------------------------------------------- agents

export type AgentsProps = {
  els: Els
  C: Colors
  cards: AgentCard[]
  mainModel: string | null
  maxCards: number
  w: number
  now: number
  viewed: string | null
  isMotion: boolean
  onToggle: (id: string) => void
  surface: string
}

type Drawing = Pick<AgentsProps, 'els' | 'C' | 'now' | 'isMotion'>

/** A connector between panels: animated while its flow is live, a dim line otherwise. */
const rail = ({ els, C, isMotion }: Drawing, key: string, isActive: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
  isMotion && 'Client' in els ? (
    <els.Client key={key} module="./rail.tsx" width={width} height={1} props={{ active: isActive, width, color, dim: C.faint, marks, isMerge }} />
  ) : (
    <els.Text color={C.faint}>{'─'.repeat(Math.max(1, width))}</els.Text>
  )

/** A start time of 0 is unknown: no clock, not decades. */
const clock = ({ els, now }: Drawing, key: string, since: number, endAt: number | null, color: string) =>
  since <= 0 ? (
    <els.Text color={color}>—</els.Text>
  ) : 'Client' in els ? (
    <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
  ) : (
    <els.Text color={color}>{fmtTimer((endAt ?? now) - since)}</els.Text>
  )

const glyphOf = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')

/** Subagents as side-by-side cards up to the limit, as swimlanes on one time axis beyond it. */
export const agentsPanel = (p: AgentsProps) => {
  const { els, C, cards, w, now, viewed, onToggle } = p
  const { Box, Text, Button } = els
  const running = cards.filter(c => c.status === 'running')
  const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
  const mainName = p.mainModel ? prettyModel(p.mainModel) : null
  // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
  const fit = Math.max(1, Math.min(p.maxCards, Math.floor((w + 1) / 21)))
  const useLanes = cards.length > fit
  const header = (
    <Box justifyContent="space-between" width={widthOf(p.surface, w)}>
      <Text bold>{`agents · ${running.length} running · ${cards.length} total`}</Text>
      {cards.length > 0 ? <Text color={C.faint}>{`1-${Math.min(cards.length, useLanes ? 6 : fit)} expand`}</Text> : null}
    </Box>
  )
  if (useLanes) {
    const shown = cards.slice(-6)
    const geo = lanes(shown, now, Math.max(8, w - 28))
    return (
      <Box flexDirection="column" width={widthOf(p.surface, w)}>
        {header}
        {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
        {shown.map((c, i) => {
          const gm = geo[i]
          const isViewed = viewed === c.id
          return (
            <Box key={`lane-${c.id}`}>
              <Text color={statusColor(c)} bold={isViewed}>{`${isViewed ? '▶' : glyphOf(c)} `}</Text>
              <Box width={17}>
                <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), 14)} onPress={() => onToggle(c.id)} />
              </Box>
              <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
              <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
              <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
              {clock(p, `lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          )
        })}
      </Box>
    )
  }
  const shown = cards.slice(-fit)
  const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
  const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
  return (
    <Box flexDirection="column" width={widthOf(p.surface, w)}>
      {header}
      {rail(p, 'fan-out', running.length > 0, C.agent, w, centers)}
      <Box columnGap={1}>
        {shown.map((c, i) => {
          const isViewed = viewed === c.id
          const sameModel = !c.model || prettyModel(c.model) === mainName
          const title = titleLines(cardTitle(c), cardW - 7, cardW - 4)
          return (
            <Box
              key={`cardbox-${c.id}`}
              flexDirection="column"
              borderStyle={isViewed ? 'double' : 'round'}
              borderColor={c.lastStop === 'max_tokens' ? C.warn : C.border}
              borderDimColor={c.status !== 'running' && !isViewed}
              width={cardW}
              paddingX={1}
            >
              <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={title[0]} onPress={() => onToggle(c.id)} />
              <Text bold wrap="truncate">
                {title[1]}
              </Text>
              <Text color={C.dim} wrap="truncate">
                {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
              </Text>
              <Text dimColor wrap="truncate">
                {c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} st` : 'starting…'}
              </Text>
              <Box>
                <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                  {cardW >= 26 ? `${glyphOf(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : c.status} ` : `${glyphOf(c)} `}
                </Text>
                <Box flexShrink={0}>{clock(p, `card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
              </Box>
            </Box>
          )
        })}
      </Box>
      {rail(p, 'merge', running.length > 0, C.agent, w, centers, true)}
    </Box>
  )
}

/** The expanded card: its full task and last tool calls. Its final answer is transcript text and is not kept. */
export const expandedPanel = ({ els, C, card, w, surface }: { els: Els; C: Colors; card: AgentCard | undefined; w: number; surface: string }) => {
  if (!card) return null
  const { Box, Text } = els
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.border} paddingX={1} width={widthOf(surface, w)}>
      <Text bold wrap="wrap">
        {card.description || card.type}
      </Text>
      <Text dimColor wrap="truncate">{`${card.type} · ${prettyModel(card.model)} · ${card.status} · ${card.steps} steps`}</Text>
      {card.tools.length === 0 ? <Text color={C.faint}>no tool calls yet</Text> : null}
      {card.tools.map((n, i) => (
        <Text key={`tool-${i}`} color={n.isError ? C.warn : C.text} wrap="truncate">
          {`${n.isError ? '✗' : '·'} ${n.text}`}
        </Text>
      ))}
    </Box>
  )
}

/** Desktop draws the agents' time axis as SVG under the panels. */
export const svgLanes = ({ els, cards, now }: { els: Els; cards: AgentCard[]; now: number }) => {
  if (!('Svg' in els) || cards.length === 0) return null
  const { Svg } = els
  const rowH = 18
  const pxW = 520
  const geo = lanes(cards.slice(-10), now, 100)
  const rects = cards
    .slice(-10)
    .map((c, i) => {
      const gm = geo[i]
      const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
      const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
      const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
      const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
      return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
    })
    .join('')
  const svgH = Math.min(10, cards.length) * rowH + 4
  return (
    <Svg
      source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
      alt={`${cards.length} agents on a time axis`}
      width={pxW}
      height={svgH}
    />
  )
}

// ---------------------------------------------------------------- gate

export type GateProps = { els: Els; C: Colors; gate: Gate; open: Bucket | null; w: number; onToggle: (b: Bucket) => void; surface: string }

const verdictColor = (C: Colors, c: Check) => (c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn)

/** One cell per permission check, totals, and per-family drill-downs (details already redacted). */
export const gatePanel = ({ els, C, gate, open, w, onToggle, surface }: GateProps) => {
  const { Box, Text, Button } = els
  const s = gateSummary(gate)
  const strip = gate.recent.slice(-Math.max(8, w - 4))
  return (
    <Box key="gate-box" flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1} width={widthOf(surface, w)}>
      <Box justifyContent="space-between">
        <Text color={C.gate} bold>
          GATE · permissions
        </Text>
        <Text dimColor>{`${s.total} checks`}</Text>
      </Box>
      <Box>
        {strip.length === 0 ? <Text color={C.faint}>no checks yet</Text> : null}
        {strip.map((c, i) => (
          <Text key={`cell-${i}`} color={verdictColor(C, c)} dimColor={c.inSubagent}>
            {c.verdict === 'deny' ? '✗' : '■'}
          </Text>
        ))}
      </Box>
      <Text wrap="truncate">
        <Text color={C.gate}>■</Text>
        <Text dimColor>{` ${s.rule} allowed  `}</Text>
        <Text color={C.cleared}>■</Text>
        <Text dimColor>{` ${s.cleared} cleared  `}</Text>
        {s.ask > 0 ? <Text color={C.amber}>{`■ ${s.ask} pending  `}</Text> : null}
        <Text color={s.deny > 0 ? C.warn : C.dim}>{`✗ ${s.deny} denied`}</Text>
        {w >= 80 && gate.recent.some(c => c.inSubagent) ? <Text color={C.faint}>{'  dim: in subagents'}</Text> : null}
      </Text>
      <Box columnGap={2}>
        {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
          const t = gate.totals[b]
          const n = t.rule + t.ask + t.cleared + t.deny
          return <Button key={`gate-${b}`} plain hotkey={b[0]} label={`${b} ${n}${open === b ? ' ▾' : ''}`} dimColor={n === 0} onPress={() => onToggle(b)} />
        })}
      </Box>
      {open
        ? gate.recent
            .filter(c => c.bucket === open)
            .slice(-5)
            .map(c => (
              <Text key={`row-${c.id}`} wrap="truncate">
                <Text color={verdictColor(C, c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                <Text color={C.dim}>{`${(c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? 'cleared' : c.verdict === 'ask' ? 'pending' : 'denied').padEnd(10)} `}</Text>
                <Text dimColor={c.inSubagent}>{shorten(c.detail, Math.max(10, w - 18))}</Text>
              </Text>
            ))
        : null}
    </Box>
  )
}
