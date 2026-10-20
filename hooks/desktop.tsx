// The band where the surface draws SVG: one size of type throughout (a semibold model, capitalised labels, digits of one width), gauges as thin
// bars, the pipeline as one line of marks, the tier as plain text, laid out to wrap where the window is narrow. The desktop app gets
// one AI-SDLC line, in the host's own frame with its close control; the editor and the phones get two rows. The terminal
// keeps its glyph line (board.tsx).
import type { BandProps } from './board'
import { barSvg, stepperSvg } from './graphics'
import type { Drawing } from './graphics'
import { modelOf, toneColor, windowOf } from './main'
import { LABELS, nowNext } from './sdlc'
import { NA, money, pctText, toneOf, untilReset } from './statusline'

/** The track under a bar and the grey of a step to come: a mid-tone that reads on light and dark. */
const GREY = '#8b93a1'

/** The pictures, labels and rows the two layouts share, for a surface that draws SVG; null where it does not. */
const kit = ({ els, C, main, usage, status, now, sdlc }: BandProps) => {
  if (!('Svg' in els)) return null
  const { Box, Text, Svg } = els
  const picture = (key: string, d: Drawing, alt: string) => <Svg key={key} source={d.source} alt={alt} width={d.width} height={d.height} />
  const caption = (key: string, text: string) => (
    <Text key={key} color={C.dim} weight="medium">
      {text}
    </Text>
  )

  // a limit: its name, a bar in the tone of the percent, the percent, and the time to its reset in small grey type
  const gauge = (key: string, label: string, pct: number | null, window: ReturnType<typeof windowOf> = null) => {
    const reset = window ? untilReset(window.resetsAt, now) : NA
    return (
      <Box key={key} alignItems="center" columnGap="xs">
        <Text color={C.dim}>{label}</Text>
        {pct === null ? (
          <Text color={C.dim}>{NA}</Text>
        ) : (
          [
            picture(`${key}-bar`, barSvg(pct / 100, toneColor(C, toneOf(pct)), GREY), `${label} ${pctText(pct)}`),
            <Text key={`${key}-pct`} weight="semibold" tabular color={toneColor(C, toneOf(pct))}>
              {pctText(pct)}
            </Text>,
            reset === NA ? null : (
              <Text key={`${key}-reset`} color={C.dim} tabular>
                {reset}
              </Text>
            ),
          ]
        )}
      </Box>
    )
  }
  const five = windowOf(usage, 'five')
  const seven = windowOf(usage, 'seven')

  /** Row 1: state, model and effort, the three limits, the spend. */
  const mainRow = () => (
    <Box key="band-main" alignItems="center" justifyContent="space-between" flexWrap="wrap" columnGap="md" rowGap="xs">
      <Box key="who" alignItems="center" columnGap="sm">
        <Text color={main.isRunning ? C.main : C.dim} weight="semibold">
          {main.isRunning ? '●' : '○'}
        </Text>
        <Text color={main.isRunning ? C.main : C.dim}>{main.isRunning ? 'Working' : 'Idle'}</Text>
        <Text weight="semibold" color={C.text}>
          {modelOf(main)}
        </Text>
        <Text color={C.dim}>{main.effort ?? NA}</Text>
      </Box>
      <Box key="gauges" alignItems="center" columnGap="md">
        {gauge('ctx', 'ctx', usage.pct)}
        {gauge('5h', '5h', five ? five.pct : null, five)}
        {gauge('7d', '7d', seven ? seven.pct : null, seven)}
      </Box>
      <Text key="spend">
        <Text weight="semibold" tabular color={C.text}>
          {money(usage.costUsd)}
        </Text>
        <Text color={C.dim} tabular>{` / ${money(status.projectCost)}`}</Text>
      </Text>
    </Box>
  )

  /** The AI-SDLC row: title, the pipeline, now and next, the build's progress, the change and its tier. Null without ai-sdlc files. */
  const sdlcRow = () => {
    if (!sdlc) return null
    const title = (
      <Text key="title" weight="semibold" color={C.accent}>
        AI-SDLC
      </Text>
    )
    if (!sdlc.activeId || !sdlc.stages) {
      return (
        <Box key="band-progress" alignItems="center" columnGap="sm">
          {title}
          <Text color={C.dim}>{sdlc.activeId ? `stages ${NA}` : 'no active change'}</Text>
        </Box>
      )
    }
    const { now: current, next } = nowNext(sdlc.stages)
    const total = sdlc.build?.length ?? 0
    const passed = sdlc.build?.filter(r => r.verdict === 'pass').length ?? 0
    return (
      <Box key="band-progress" alignItems="center" flexWrap="wrap" columnGap="md" rowGap="xs">
        {title}
        {picture('stepper', stepperSvg(sdlc.stages, { done: C.git, current: C.folder, grey: GREY }), `AI-SDLC: ${Object.entries(sdlc.stages).map(([s, v]) => `${s} ${v}`).join(', ')}`)}
        <Box key="steps" alignItems="center" columnGap="md" rowGap="xs" flexWrap="wrap">
          {current ? (
            <Box key="now-next" alignItems="center" columnGap="xs">
              {caption('now-label', 'Now')}
              <Text weight="semibold" color={C.folder}>
                {LABELS[current]}
              </Text>
              {next ? [<Text key="gap"> </Text>, caption('next-label', 'Next'), <Text key="next" weight="semibold" color={C.accent}>{LABELS[next]}</Text>] : null}
            </Box>
          ) : (
            <Text color={C.dim}>{(sdlc.next ?? 'closed').replace(/^./, c => c.toUpperCase())}</Text>
          )}
          {total > 1 ? (
            <Box key="done" alignItems="center" columnGap="xs">
              {picture('done-bar', barSvg(passed / total, C.git, GREY, 36), `${passed} of ${total} build steps passed`)}
              <Text tabular>
                <Text weight="semibold" color={C.git}>
                  {String(passed)}
                </Text>
                <Text color={C.dim}>{`/${total}`}</Text>
              </Text>
            </Box>
          ) : null}
        </Box>
        <Box key="change" flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end" alignItems="center" columnGap="sm">
          <Text>
            <Text color={C.dim}>Tier </Text>
            <Text color={C.accent} weight="semibold">
              {(sdlc.tier ?? NA).toUpperCase()}
            </Text>
          </Text>
          <Text wrap="truncate" color={C.dim}>
            {sdlc.activeId}
          </Text>
        </Box>
      </Box>
    )
  }

  return { mainRow, sdlcRow }
}

/** Both rows (the editor, the phones), or null where the surface draws no SVG (the caller then draws the terminal's). */
export const desktopRows = (p: BandProps) => {
  const k = kit(p)
  if (!k) return null
  const second = k.sdlcRow()
  return second ? [k.mainRow(), second] : [k.mainRow()]
}

/**
 * The desktop app's band: one line of the AI-SDLC alone: the title, the step now, the tier, the change (cut at the edge), the small pipeline with
 * the build's count after it, and the close control. No border of its own: the host frames the band and draws the close control, as
 * it does for its other panels. Null without ai-sdlc files, or off the desktop.
 */
export const desktopPanel = (p: BandProps & { onClose: () => void }) => {
  const { els, C, sdlc } = p
  if (!sdlc || !('Svg' in els) || !('Button' in els)) return null
  const { Box, Text, Svg, Button } = els
  const stages = sdlc.stages
  const current = stages ? nowNext(stages).now : null
  const total = sdlc.build?.length ?? 0
  const passed = sdlc.build?.filter(r => r.verdict === 'pass').length ?? 0
  const pipeline = stages ? stepperSvg(stages, { done: C.git, current: C.folder, grey: GREY }) : null

  // the title, the step now, the tier and the change, each after a small dot
  const parts = [
    <Text key="title" weight="semibold" color={C.accent}>
      AI-SDLC
    </Text>,
    // the step now, in orange like its mark; a closed change has none (its outcome follows the change)
    current ? (
      <Text key="current" weight="semibold" color={C.folder}>
        {LABELS[current]}
      </Text>
    ) : null,
    sdlc.activeId && stages ? (
      <Text key="tier">
        <Text color={C.dim}>Tier </Text>
        <Text color={C.accent} weight="semibold">
          {(sdlc.tier ?? NA).toUpperCase()}
        </Text>
      </Text>
    ) : null,
    <Box key="change" flexShrink={1} minWidth={0} columnGap="sm">
      <Text wrap="truncate" color={C.dim}>
        {sdlc.activeId ? sdlc.activeId : 'No active change'}
      </Text>
      {sdlc.activeId && stages && !current ? <Text color={C.dim}>{(sdlc.next ?? 'closed').replace(/^./, c => c.toUpperCase())}</Text> : null}
    </Box>,
  ].filter(x => x !== null)
  const left = parts.flatMap((part, i) => (i === 0 ? [part] : [<Text key={`dot-${i}`} color={C.dim}>·</Text>, part]))

  return (
    <Box key="band-panel" alignItems="center" columnGap="md">
      <Box key="left" flexGrow={1} flexShrink={1} minWidth={0} alignItems="center" columnGap="xs">
        {left}
      </Box>
      {pipeline && stages ? (
        <Svg key="stepper" source={pipeline.source} alt={`AI-SDLC: ${Object.entries(stages).map(([s, v]) => `${s} ${v}`).join(', ')}`} width={pipeline.width} height={pipeline.height} />
      ) : null}
      {/* the build's count: the steps that passed out of all of them, the passed number in green */}
      {total > 1 ? (
        <Text key="done" tabular>
          <Text weight="semibold" color={C.git}>
            {String(passed)}
          </Text>
          <Text color={C.dim}>{`/${total}`}</Text>
        </Text>
      ) : null}
      {/* the host draws a dismiss Button's label as its text where there is no child: both are the icon, so it is always × */}
      <Button key="close" role="dismiss" label="×" onPress={p.onClose}>
        <Text color={C.dim}>×</Text>
      </Button>
    </Box>
  )
}
