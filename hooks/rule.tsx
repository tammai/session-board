// A horizontal rule that is the same width on every surface.
import type { Els } from './board'

/**
 * A rule `cells` columns wide. On the terminal it is a row of ─, one character to a column. Elsewhere (the desktop
 * app's font is not monospaced) a row of ─ is not the width of its container and wraps, leaving a stray short line,
 * so it is a thin SVG line. Its width is not guessed: the markup is very wide, no `width` is given, and the host sizes
 * the box to the room it has ("up to the slot"); `preserveAspectRatio="none"` stretches the line across that box, and the
 * fixed 3 px `height` keeps it thin.
 */
export const rule = ({ els, color, hex, cells, surface }: { els: Els; color: string; hex: string; cells: number; surface: string }) => {
  if (surface !== 'terminal' && 'Svg' in els) {
    const { Box, Svg } = els
    return (
      <Box flexGrow={1}>
        <Svg
          source={`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="3" viewBox="0 0 2000 3" preserveAspectRatio="none"><line x1="0" y1="1.5" x2="2000" y2="1.5" stroke="${hex}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`}
          alt="divider"
          height={3}
        />
      </Box>
    )
  }
  const { Text } = els
  return <Text color={color}>{'─'.repeat(Math.max(0, cells))}</Text>
}
