import { expect, test } from 'claude-code/testing'

import {
  EMPTY_LEDGER,
  NA,
  applySession,
  cellsOf,
  money,
  normalizeLedger,
  normalizeProject,
  pctText,
  projectKey,
  projectTotal,
  shortBranch,
  toneOf,
  untilReset,
} from '../hooks/statusline'

test('gauges: green to 50, orange above, red from 80; five cells rounded to nearest; bad numbers clamp', () => {
  expect([50, 51, 79, 80].map(toneOf)).toEqual(['green', 'orange', 'orange', 'red'])
  expect(cellsOf(0)).toEqual({ on: 0, off: 5 })
  expect(cellsOf(50)).toEqual({ on: 3, off: 2 })
  expect(cellsOf(100)).toEqual({ on: 5, off: 0 })
  expect([cellsOf(Number.NaN), cellsOf(-5), cellsOf(140)]).toEqual([{ on: 0, off: 5 }, { on: 0, off: 5 }, { on: 5, off: 0 }])
  expect([pctText(Number.NaN), pctText(null), pctText(42.4), pctText(140)]).toEqual([NA, NA, '42%', '100%'])
})

test('a reset reads as the time left, now once it has passed, N/A when unknown', () => {
  const now = 1_000_000_000
  const at = (ms: number) => now + ms
  const min = 60_000
  expect(untilReset(at(43 * min), now)).toBe('43m')
  expect(untilReset(at(134 * min), now)).toBe('2h14m')
  expect(untilReset(at((4 * 24 + 3) * 60 * min), now)).toBe('4d3h')
  expect(untilReset(at(-5 * min), now)).toBe('now')
  expect([untilReset(null, now), untilReset(undefined, now), untilReset(Number.NaN, now)]).toEqual([NA, NA, NA])
})

test('money and branch text: two decimals, N/A when unknown, a long branch cut with an ellipsis', () => {
  expect([money(1.234), money(0), money(null), money(Number.NaN)]).toEqual(['$1.23', '$0.00', NA, NA])
  expect(shortBranch('feature/a-very-long-branch-name-here')).toBe('feature/a-very-long-bra…')
  expect(shortBranch('main')).toBe('main')
})

test('the project key is the one statusline.sh uses: forward slashes, no trailing slash, SHA-1[:16]', async () => {
  // the keys are what `printf %s <path> | sha1sum | cut -c1-16` gives, the folder names statusline.sh keeps its records under
  expect(normalizeProject('C:\\Users\\me\\projects\\demo\\')).toBe('C:/Users/me/projects/demo')
  expect(await projectKey('C:\\Users\\me\\projects\\demo\\')).toBe('6a1a27ab17469111')
  expect(await projectKey('C:/work/other-project')).toBe('e232c9f235421b1e')
})

test("the board's own ledger counts like statusline.sh: base + last per session, a restarted counter keeps what came before", () => {
  const l0 = applySession(EMPTY_LEDGER, 'a', 1.5)
  expect(projectTotal(l0)).toBe(1.5)
  const l1 = applySession(l0, 'a', 2) // the session's total grows
  expect(l1.sessions.a).toEqual([0, 2])
  const l2 = applySession(l1, 'a', 0.5) // lower than before: the counter restarted (a resumed session)
  expect(l2.sessions.a).toEqual([2, 0.5])
  expect(projectTotal(applySession(l2, 'b', 3))).toBe(5.5) // 2 + 0.5 + 3
  expect(projectTotal(EMPTY_LEDGER)).toBe(null)
  // a total that is not a usable number leaves the ledger as it was
  expect([Number.NaN, -1, Infinity].map(n => applySession(l2, 'a', n))).toEqual([l2, l2, l2])
})

test('a stored ledger of any shape reads as a ledger: bad entries are dropped, nothing throws', () => {
  expect(normalizeLedger(undefined)).toEqual(EMPTY_LEDGER)
  expect(normalizeLedger('junk')).toEqual(EMPTY_LEDGER)
  expect(normalizeLedger({ imported: true, sessions: { a: [1, 2], b: 'x', c: [1], d: [Number.NaN, 1] } })).toEqual({ imported: true, sessions: { a: [1, 2] } })
})
