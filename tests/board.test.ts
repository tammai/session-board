import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BACKLOG, TIER_M, TIER_S } from './fixtures/sdlc'

// ---------------------------------------------------------------- a mocked host

const ROOT = '/work/session-board'
const LEDGER = '/home/me/.claude/statusline-cost/46ec31dcd0eb7eec' // sha1(ROOT)[:16]
const ID = '2026-10-19-open-change'

const openMDocs = () => {
  const { review: _review, ...rest } = TIER_M
  return { ...rest, intent: (TIER_M.intent as string).replace('outcome: shipped\n', '') }
}

const SHIPPED = '2026-10-14-ship-notifies-the-human-when-a-change-is-closed'

const project = (): Record<string, string> => ({
  [`${ROOT}/.sdlc/config.json`]: '{}',
  [`${ROOT}/.sdlc/local/state.json`]: JSON.stringify({
    active: ID,
    dirty: true,
    lastVerify: '2026-10-19T13:58:20Z',
    implementers: { [ID]: [{ agent: 'ai-sdlc:implementer', model: 'sonnet' }] },
    build: { [ID]: { steps: { spec: { rounds: 2, model: 'sonnet', verdict: 'pass' } } } },
  }),
  ...Object.fromEntries(Object.entries(TIER_S).map(([k, v]) => [`${ROOT}/docs/sdlc/${SHIPPED}/${k}.md`, v])),
  [`${ROOT}/docs/project/backlog.md`]: BACKLOG,
  [`${LEDGER}/sess-0`]: '{"base": 10.0, "last": 4.8}',
  ...Object.fromEntries(Object.entries(openMDocs()).map(([k, v]) => [`${ROOT}/docs/sdlc/${ID}/${k}.md`, v])),
})

const MIN = 60_000
const USAGE = {
  context: { window: 200_000, percent: 42, tokens: 84_000 },
  cost: { usd: 1.23 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: new Date(43 * MIN).toISOString() }],
}

/** The engine resolves a path to the platform's form (`C:\work\x` on Windows); the fake project keys are POSIX. */
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

/** Answers what sits beneath the plugin: the session, its files, git and the environment. */
const calls = { git: 0 }

const host = (on: On, files: Record<string, string> = project(), git = '## main...origin/main\n M a.ts\n M b.ts\n', hold?: Promise<unknown>, settings: Record<string, unknown> = {}) => {
  calls.git = 0
  const clock = mock.clock(on)
  mock.env(on, { USERPROFILE: '/home/me' })
  mock.store(on) // the host's store: the board's own cost ledger
  on('settings.read', () => ({ value: settings }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', () => ({ value: { command: 'session-board' } }) as never)
  on('session.start', () => ({ cwd: ROOT }) as never)
  on('session.cwd', () => ({ value: ROOT }))
  on('session.root', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('fs.read', (_$, e) => {
    const text = files[posix(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_$, e) => {
    const dir = posix(e.path)
    const seen = new Map<string, 'file' | 'dir'>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(`${dir}/`)) continue
      const [first, ...rest] = p.slice(dir.length + 1).split('/')
      if (first) seen.set(first, rest.length > 0 ? 'dir' : 'file')
    }
    if (seen.size === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: [...seen].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', async (_$, e) => {
    calls.git += 1
    if (hold) await hold
    // `git diff --numstat`: 12 lines added and 3 removed (a binary file has none); anything else is `git status`.
    const stdout = e.argv.includes('diff') ? '10\t2\ta.ts\n2\t1\tb.ts\n-\t-\timg.png\n' : git
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.step', async function* () {
    return { turnId: 'S1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return { clock }
}

const pane = (bodyColumns: number) => ({
  plugin: 'session-board',
  component: 'Pane' as const,
  requestId: 'session-board',
  props: { title: 'Session Board', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 70 }, view: {} },
})

type Test$ = Engine

const begin = async ($: Test$) => {
  await $.session.start({ cwd: ROOT, surface: 'terminal' } as never)
}

/** One main-loop request, so the board learns the effort level. */
const oneStep = async ($: Test$) => {
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
}

const SURFACES = ['terminal', 'desktop'] as const

// ---------------------------------------------------------------- Main

type Mounted = { find: (q: { key?: string; type?: string; text?: RegExp }) => Promise<{ text?: string; props: Record<string, unknown> } | undefined> }
const rowOf = async (ui: Mounted, key: string) => (await ui.find({ key }))?.text ?? ''

test('the main panel shows the model, effort, context, cost and limits, and the branch with its changes', async ($, on) => {
  host(on)
  await begin($)
  await oneStep($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(110), surface })
    expect(await rowOf(ui, 'board-title')).toBe('SESSION-BOARD · $1.23/$16.03') // the project's name in capitals, then this session / the project spend
    // the title: the model with its effort as plain text, and whether it works (the spend is in the heading)
    expect(await rowOf(ui, 'main-title')).toBe('Opus 5.5 high○ idle')
    // the context gauge joins the limits, in the same style
    expect(await rowOf(ui, 'main-limits')).toMatch(/^ctx ██░░░ 42% · 5h ████░ 85% 43m · 7d N\/A$/) // the context as a percent only; small dots between the three
    for (const gone of ['main-effort', 'main-cost']) expect(await ui.find({ key: gone })).toBeUndefined() // their rows are gone
    // the statusline's style: bold white label, block cells, a bold percentage, the reset time in grey and no arrow
    const label = await ui.find({ text: /^5h $/ })
    expect([label?.props.color, label?.props.bold]).toEqual(['#e0def4', true])
    expect((await ui.find({ text: /^████$/ }))?.props.color).toBe('#d81e5b') // the filled cells take the tone: red from 80%
    expect((await ui.find({ text: /^░$/ }))?.props.color).toBe('subtle') // the empty one stays quiet
    expect((await ui.find({ text: /^ 43m$/ }))?.props.color).toBe('inactive')
    // a line separates the gauges from the branch: the panel's 106 inner columns wide, between the two rows
    // the terminal draws the rule as text; the desktop app's font is not monospaced, where a row of ─ would wrap, so it is a thin SVG line
    expectRule(await ui.find({ key: 'main-rule' }), surface, '─'.repeat(106))
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.indexOf('"key":"main-limits"')).toBeLessThan(drawn.indexOf('"key":"main-rule"'))
    expect(drawn.indexOf('"key":"main-rule"')).toBeLessThan(drawn.indexOf('"key":"main-git"'))
    expect(await rowOf(ui, 'main-git')).toMatch(/^ ⎇ main .*\+12.*-3$/) // a branch glyph, the branch, and the total lines added and removed
    expect((await ui.find({ text: /^ 42%$/ }))?.props.color).toBe('#59c9a5') // up to 50: green
    expect((await ui.find({ text: /^ 85%$/ }))?.props.color).toBe('#d81e5b') // from 80: red
    expect((await ui.find({ type: 'Text', text: /^ ⎇ main $/ }))?.props.backgroundColor).toBe('#f3ae35') // a changed tree: yellow
    expect((await ui.find({ text: /^\+12$/ }))?.props.color).toBe('#59c9a5')
    expect((await ui.find({ text: /^-3$/ }))?.props.color).toBe('#d81e5b')
    await ui.unmount()
  }
})

test("the effort shows before the first request, from the settings, and a request's own value replaces it", async ($, on) => {
  host(on, project(), undefined, undefined, { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } })
  await begin($)
  const before = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await rowOf(before, 'main-title')).toBe('Opus 5.5 xhigh○ idle')
  await before.unmount()
  await oneStep($) // the request says high
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await rowOf(after, 'main-title')).toBe('Opus 5.5 high○ idle')
  await after.unmount()
})

test('the changes sit at the right of the git row and the branch name takes the room that is left', async ($, on) => {
  const branch = `fix/${'x'.repeat(66)}` // 70 characters
  host(on, project(), `## ${branch}...origin/x
 M a.ts
`)
  await begin($)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' }) // 60 inner columns
  expect((await ui.find({ key: 'main-git' }))?.props.justifyContent).toBe('space-between') // the changes are pushed to the right edge
  // the chip gets 60 less the changes ("+12 -3": 6) and a gap: 53 columns, 49 for the name after the glyph and spaces, not a fixed 24
  expect(await rowOf(ui, 'main-git')).toBe(` ⎇ ${branch.slice(0, 48)}… +12-3`)
  await ui.unmount()
  const roomy = await $.ui.mount({ ...pane(110), surface: 'terminal' })
  expect(await rowOf(roomy, 'main-git')).toBe(` ⎇ ${branch} +12-3`) // with room, the whole name
  await roomy.unmount()
})

test('the main panel says working during a turn and idle after it', async ($, on) => {
  host(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await begin($)
  await $.turn.start({ text: 'go', turnId: 'T1' } as never)
  const working = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await rowOf(working, 'main-title')).toMatch(/● working$/)
  await working.unmount()
  await $.turn.complete({ turnId: 'T1', reason: 'answer', durationMs: 1, answer: '' } as never)
  const idle = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await rowOf(idle, 'main-title')).toMatch(/○ idle$/)
  await idle.unmount()
})

test('a compaction of the main context is counted next to the gauge', async ($, on) => {
  host(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as never)
  await begin($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await rowOf(ui, 'main-limits')).toMatch(/42% +⟲1 · 5h /) // the compactions follow the gauge
  await ui.unmount()
})

test('the pane is titled with the project name', async ($, on) => {
  host(on)
  const titles: string[] = []
  on('ui.open', (_$, e) => {
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } } as never
  })
  await begin($)
  await run($, 'open')
  expect(titles.at(-1)).toBe('SESSION-BOARD') // the folder of the session's root (ROOT = /work/session-board)
})

test('with nothing readable the board still draws, every missing value as N/A', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-board' } }) as never)
  on('session.start', () => ({ cwd: ROOT }) as never)
  on('ui.status', () => ({ value: undefined }))
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(110), surface })
    expect(await rowOf(ui, 'board-title')).toBe('SESSION BOARD · N/A/N/A') // no project name read yet
    expect(await rowOf(ui, 'main-title')).toBe('N/A N/A○ idle') // the model and the effort, both unknown
    expect(await rowOf(ui, 'main-limits')).toBe('ctx N/A · 5h N/A · 7d N/A')
    expect(await rowOf(ui, 'main-git')).toMatch(/^ ⎇ N\/A .*N\/A$/)
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- AI-SDLC

/** A rule: text on the terminal, where every character is one column; a thin SVG line elsewhere, where a row of ─ would wrap. */
const expectRule = (found: { text?: string } | undefined, surface: string, asText: string) => {
  const drawn = JSON.stringify(found ?? {})
  if (surface === 'terminal') expect(found?.text).toBe(asText)
  else {
    expect(drawn).toContain('"type":"Svg"')
    expect(drawn).not.toContain('──') // no run of box-drawing characters to wrap
    // no width is given: the host sizes it to the room it has, and the line is stretched across (a fixed height keeps it thin)
    expect(drawn).toContain('preserveAspectRatio=\\"none\\"')
    expect(drawn).toContain('"height":3')
    expect(drawn).not.toContain('"width":')
  }
}

/** The stepper: on the terminal icons joined by lines over a row of labels; on desktop one SVG. */
const expectStepper = async (ui: Mounted, surface: string, icons: string, alt: string) => {
  if (surface === 'terminal') {
    expect((await rowOf(ui, 'stage-icons')).replace(/[─ ]/g, '')).toBe(icons)
    expect((await rowOf(ui, 'stage-labels')).replace(/ /g, '')).toBe('IntentSpecPlanBuildVerifyReviewShipKnowledge')
  } else {
    expect(JSON.stringify(await ui.find({ key: 'stage-svg' }))).toContain(`"alt":"${alt}"`) // the progress line, not a rule
  }
}


test('the AI-SDLC section shows the stepper, build rounds and one checklist: working, pending, done', async ($, on) => {
  host(on)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    const has = async (text: RegExp) => expect(await ui.find({ text })).toBeDefined()
    await has(/^AI-SDLC$/)
    expect((await ui.find({ text: /^AI-SDLC$/ }))?.props.color).toBe('#87ceeb') // the title is sky blue, like the borders
    await has(new RegExp(`^${ID}$`))
    await has(/^tier M$/)
    // the stages as a progress line: icons joined by lines, the labels under them
    await expectStepper(ui, surface, '✔✔✔✔✔◉○○', 'Intent done, Spec done, Plan done, Build done, Verify done, Review current, Ship todo, Knowledge todo')
    // the step now and the step next, in a neutral colour; the same words as the band's second line
    await has(/^now Review · next Ship$/)
    expect((await ui.find({ text: /^now Review · next Ship$/ }))?.props.color).toBe('text')
    await has(/^unverified edits$/)
    await has(/^spec 2\/3 pass sonnet$/)
    await has(/^implementer ai-sdlc:implementer \(sonnet\)$/)
    // one list: what is being worked on first, the backlog next, finished changes last
    // an empty row sits above the list, which is titled "Tasks"
    const drawn = JSON.stringify(await ui.drawn())
    expect(await ui.find({ key: 'checklist-gap' })).toBeDefined()
    expect(drawn.indexOf('checklist-gap')).toBeGreaterThan(0)
    expect(drawn.indexOf('checklist-gap')).toBeLessThan(drawn.indexOf('"key":"checklist"'))
    const heading = await ui.find({ type: 'Text', text: /^Tasks$/ })
    expect(heading?.props.color).toBe('#ffffff') // white
    expect(heading?.props.backgroundColor).toBeUndefined() // no chip: the board's own dark background
    // a line runs from the title across the rest of the row: the 96 inner columns less "Tasks" and the gap
    expectRule(await ui.find({ key: 'checklist-head' }), surface, `Tasks${'─'.repeat(90)}`)
    if (surface === 'terminal') expect((await ui.find({ text: /^─{90}$/ }))?.props.color).toBe('#87ceeb') // the Tasks line, not a stepper line
    const list = await rowOf(ui, 'checklist')
    expect(surface === 'terminal' ? list : list.replace(/^Tasks/, 'Tasks' + '─'.repeat(90))).toBe(`Tasks${'─'.repeat(90)}[>] ${ID} · review[ ] D1 Worktree support[ ] L2 session-board, remade separately[x] ${SHIPPED}`)
    // the metrics row is gone
    for (const gone of [/^shipped /, /^spec rework /, /^plan edits /, /^guard denials /]) expect(await ui.find({ text: gone })).toBeUndefined()
    await ui.unmount()
  }
})

test('a tier S change shows its spec and review as skipped', async ($, on) => {
  const files = project()
  files[`${ROOT}/.sdlc/local/state.json`] = JSON.stringify({ active: SHIPPED, dirty: false })
  host(on, files)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    await expectStepper(ui, surface, '✔⊖✔✔✔⊖✔○', 'Intent done, Spec skipped, Plan done, Build done, Verify done, Review skipped, Ship done, Knowledge todo')
    await ui.unmount()
  }
})

test('on a narrow board the current step is named in full and the others by their first letter, each under its mark', async ($, on) => {
  host(on)
  await begin($)
  const narrow = await $.ui.mount({ ...pane(64), surface: 'terminal' }) // 60 inner columns: 7 per step, too few for "Knowledge"
  const labels = await rowOf(narrow, 'stage-labels')
  expect(labels.replace(/ /g, '')).toBe('ISPBVReviewSK') // Review is in progress; the rest are initials
  expect(labels.indexOf('Review')).toBe(35) // its mark is at column 5 x 7 + 3 = 38; the name is centred on it
  expect([3, 10, 17, 24, 31, 45, 52].map(i => labels[i]).join('')).toBe('ISPBVSK') // an initial sits under each other mark
  expect((await rowOf(narrow, 'stage-icons')).replace(/[─ ]/g, '')).toBe('✔✔✔✔✔◉○○') // all the marks stay
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect((await rowOf(wide, 'stage-labels')).replace(/ /g, '')).toBe('IntentSpecPlanBuildVerifyReviewShipKnowledge') // room for every name
  await wide.unmount()
})

test('in the band a closed change shows its marks and says closed', async ($, on) => {
  const files = project()
  files[`${ROOT}/.sdlc/local/state.json`] = JSON.stringify({ active: SHIPPED, dirty: false })
  host(on, files)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }))
  await begin($)
  await run($, 'compact')
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(ui, 'band-progress')).toBe('AI-SDLC ✔─⊖─✔─✔─✔─⊖─✔─○  closed') // nothing is in progress
  await ui.unmount()
})

test('the card and the band agree on the step now and the step next', async ($, on) => {
  // a tier S change that has passed verify and is not yet shipped: Spec and Review are skipped, Ship is in progress
  const files = project()
  const id = '2026-10-19-ship-is-now'
  const open = (TIER_S.intent as string).replace('outcome: shipped\n', '')
  for (const [k, v] of Object.entries({ ...TIER_S, intent: open })) files[`${ROOT}/docs/sdlc/${id}/${k}.md`] = v
  files[`${ROOT}/.sdlc/local/state.json`] = JSON.stringify({ active: id, dirty: false })
  host(on, files)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }))
  await begin($)
  const full = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await full.find({ text: /^now Ship · next Knowledge$/ })).toBeDefined() // not "next: ship"
  expect(await full.find({ text: /^next: / })).toBeUndefined()
  await full.unmount()
  await run($, 'compact')
  const compact = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(compact, 'band-progress')).toBe('AI-SDLC ✔─⊖─✔─✔─✔─⊖─◉─○  now Ship · next Knowledge')
  await compact.unmount()
})

test('on the terminal long names are cut at a character count; on desktop the host cuts them at the real edge', async ($, on) => {
  const branch = `fix/${'x'.repeat(66)}` // 70 characters
  host(on, project(), `## ${branch}...origin/x
 M a.ts
`)
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(64), surface }) // a name of 59 characters does not fit 40 terminal columns
    const list = await rowOf(ui, 'checklist')
    const git = await rowOf(ui, 'main-git')
    if (surface === 'terminal') {
      expect(list).toContain('…') // the id is cut to fit the columns
      expect(list).toContain(`[x] ${SHIPPED.slice(0, 55)}…`) // a done row has no note after it: its id gets the whole row, 4 for the border and padding, 4 for the mark
      expect(git).toContain('…')
    } else {
      // a proportional font fits more than the column count says: the whole text goes to the host, which truncates it
      expect(list).toContain(SHIPPED)
      expect(git).toContain(` ⎇ ${branch} `)
      expect(list + git).not.toContain('…')
      expect((await ui.find({ type: 'Text', text: new RegExp(String.raw`^\[x\] ${SHIPPED}$`) }))?.props.wrap).toBe('truncate')
      expect((await ui.find({ type: 'Text', text: new RegExp(` ⎇ ${branch} `) }))?.props.wrap).toBe('truncate')
    }
    await ui.unmount()
  }
})

test('on desktop a blank row separates the sections: the panels from the heading and each other, and the parts of the AI-SDLC card; the terminal has none', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sp1' }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Look around'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    for (const key of ['panel-main', 'panel-sdlc', 'panel-agents', 'stage-block', 'status-block']) {
      // the blank rows are for the desktop app; the terminal keeps its rows
      expect([key, (await ui.find({ key }))?.props.marginTop ?? 0]).toEqual([key, surface === 'terminal' ? 0 : 1])
    }
    await ui.unmount()
  }
})

test('on desktop the progress line is sized to the pane, and a narrow pane names only the current step in full', async ($, on) => {
  host(on)
  await begin($)
  const svgOf = async (cols: number) => {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'desktop' })
    const found = JSON.stringify(await ui.find({ key: 'stage-svg' }))
    await ui.unmount()
    return found
  }
  const wide = await svgOf(100) // room for every name, capped at 640 px
  expect(wide).toContain('"width":640')
  for (const name of ['Intent', 'Review', 'Knowledge']) expect(wide).toContain(`>${name}<`)
  const narrow = await svgOf(44) // 40 inner columns: 340 px, too few for every name
  expect(narrow).toContain('"width":340')
  expect(narrow).toContain('>Review<') // the current step in full
  expect(narrow).toContain('>K<') // the others by their first letter
  expect(narrow).not.toContain('>Knowledge<')
})

test('on desktop the panels fill the pane, so the room left and right is the same; on the terminal they are as wide as its columns', async ($, on) => {
  host(on)
  on('tool.check', () => ({ decision: 'allow' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'fw1' }))
  await begin($)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  await $.agent.spawn(spawn('general-purpose', 'Look around'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    for (const key of ['board-box', 'main-box', 'sdlc-box', 'agents-box', 'gate-box']) {
      // a count of columns turns into fewer pixels than the pane has, and the rest lands on one side
      expect([key, (await ui.find({ key }))?.props.width]).toEqual([key, surface === 'terminal' ? 100 : '100%'])
    }
    await ui.unmount()
  }
  const wide = await $.ui.mount({ ...pane(120), surface: 'desktop' }) // two columns: each half of the pane
  expect((await wide.find({ key: 'column-left' }))?.props.width).toBe('50%')
  await wide.unmount()
})

test("control characters in a subagent's task description never reach the terminal", async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'cc1' }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Look[31m around the repo'))
  const hasControl = (s: string) => /[ --]/.test(s)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(hasControl((await ui.find({ key: 'agents-box' }))?.text ?? '')).toBe(false) // the card's title
  expect((await ui.find({ key: 'agents-box' }))?.text).toContain('Look')
  await ui.press({ key: 'card-cc1' })
  expect(hasControl((await ui.find({ key: 'agents-box' }))?.text ?? '')).toBe(false) // the expanded card's full task
  await ui.unmount()
})

test('a project with no ai-sdlc files has no section', async ($, on) => {
  host(on, { [`${ROOT}/README.md`]: '# hi' })
  await begin($)
  const ui = await $.ui.mount({ ...pane(110), surface: 'terminal' })
  expect(await ui.find({ text: /^AI-SDLC$/ })).toBeUndefined()
  expect(await ui.find({ key: 'main-title' })).toBeDefined() // the rest of the board is unaffected
  await ui.unmount()
})

test('a project with only .sdlc/config.json shows the section with what is missing read as N/A', async ($, on) => {
  host(on, { [`${ROOT}/.sdlc/config.json`]: '{}' })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(110), surface })
    expect(await ui.find({ text: /^AI-SDLC$/ })).toBeDefined()
    expect(await ui.find({ text: /^no active change$/ })).toBeDefined()
    expect(await ui.find({ text: /^pending N\/A$/ })).toBeDefined() // no backlog to read
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- Agents and Gate

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  host(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from the main model: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of SURFACES) {
    const lanes = await $.ui.mount({ ...pane(64), surface })
    expect(await lanes.find({ text: /4 total/ })).toBeDefined()
    expect(await lanes.find({ text: /━/ })).toBeDefined()
    await lanes.unmount()
  }
})

test('the gate fills from checks and a row opens its redacted drill-down', async ($, on) => {
  host(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await begin($)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ text: /^2 checks$/ })).toBeDefined()
    expect(await ui.find({ text: /1 pending/ })).toBeDefined()
    await ui.press({ key: 'gate-shell' })
    expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
    expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
    await ui.press({ key: 'gate-shell' }) // close it again: the open row is shared state
    await ui.unmount()
  }
})

test('docked from 110 columns the panels sit in two columns; narrower, in one', async ($, on) => {
  host(on)
  on('tool.check', () => ({ decision: 'allow' }))
  await begin($)
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  const wide = await $.ui.mount({ ...pane(110), surface: 'terminal' })
  expect(await wide.find({ key: 'columns' })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await narrow.find({ key: 'columns' })).toBeUndefined()
  await narrow.unmount()
})

// ---------------------------------------------------------------- command and band

const band = (bodyColumns: number) => ({
  plugin: 'session-board',
  component: 'AbovePrompt' as const,
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns, scroll: { offset: 0, bodyRows: 8 }, view: {} },
})

const run = ($: Test$, args: string) => $.command.run({ command: 'session-board', args } as never) as Promise<{ text: string }>

test('compact puts the Status row and one AI-SDLC line above the prompt; open and close take them away', async ($, on) => {
  host(on)
  let isRoom = true
  on('ui.open', () => ({ value: isRoom ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is under 110 columns' } }) as never)
  let closes = 0
  on('ui.close', () => {
    closes += 1
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never) // what sits beneath
  await begin($)
  const idle = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await idle.find({ text: /^the engine band$/ })).toBeDefined()
  expect(await idle.find({ key: 'band-main' })).toBeUndefined() // not compact: the board's band yields
  await idle.unmount()

  expect((await run($, 'compact')).text).toMatch(/compact/i)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(100), surface })
    // line 1: working or idle, model and effort, context, the two limits, the spend
    expect(await rowOf(ui, 'band-main')).toBe('○ idle · Opus 5.5 N/A · ctx 42% · 5h 85% 43m · 7d N/A · $1.23/$16.03') // each limit's reset time follows its percent
    expect((await ui.find({ text: /^ 43m$/ }))?.props.color).toBe('inactive') // in grey, as in the statusline
    // line 2: the eight steps as a progress line, the step now, the step next
    expect(await rowOf(ui, 'band-progress')).toBe('AI-SDLC ✔─✔─✔─✔─✔─◉─○─○  now Review · next Ship')
    expect((await ui.find({ text: /^now Review · next Ship$/ }))?.props.color).toBe('text') // neutral, not orange
    expect((await ui.find({ text: /^AI-SDLC$/ }))?.props.color).toBe('#87ceeb') // the line is titled, in the card's sky blue
    // an orange border round the band
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('"borderStyle":"round"')
    expect(drawn).toContain('"borderColor":"claude"')
    await ui.unmount()
  }
  await run($, 'open')
  const after = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await after.find({ text: /^the engine band$/ })).toBeDefined()
  expect(await after.find({ key: 'band-main' })).toBeUndefined()
  await after.unmount()

  isRoom = false // a terminal too narrow for a pane: the band is the board
  const closedBefore = closes
  expect((await run($, 'open')).text).toMatch(/compact band/)
  expect(closes).toBeGreaterThan(closedBefore) // the unseated pane request is withdrawn, so it cannot appear later beside the band
  const narrow = await $.ui.mount({ ...band(90), surface: 'terminal' })
  expect(await narrow.find({ key: 'band-main' })).toBeDefined()
  await narrow.unmount()
})

test('reset clears agents and permission checks and keeps the Status row; an unknown word lists the four', async ($, on) => {
  host(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Tidy the fixtures'))
  const before = await $.ui.mount({ ...pane(110), surface: 'terminal' })
  expect(await before.find({ text: /Tidy the fixtures/ })).toBeDefined()
  await before.unmount()
  expect((await run($, 'reset')).text).toMatch(/reset/i)
  const after = await $.ui.mount({ ...pane(110), surface: 'terminal' })
  expect(await after.find({ text: /Tidy the fixtures/ })).toBeUndefined()
  expect(await after.find({ key: 'main-title' })).toBeDefined()
  await after.unmount()
  expect((await run($, 'bogus')).text).toContain('open|close|compact|reset')
})

// ---------------------------------------------------------------- review fixes

test('a turn end always re-reads the repo, even right after another read', async ($, on) => {
  const files = project()
  host(on, files)
  on('turn.complete', () => ({ text: '' }))
  await begin($)
  files[`${ROOT}/.sdlc/local/state.json`] = JSON.stringify({ active: null, dirty: false })
  await $.turn.complete({ turnId: 'T1', reason: 'answer', durationMs: 1, answer: '' } as never)
  const ui = await $.ui.mount({ ...pane(100), surface: 'terminal' })
  expect(await ui.find({ text: /^no active change$/ })).toBeDefined()
  await ui.unmount()
})

// The kit cannot raise the person's own close (the close mark, ctrl+x x), so the hand-close hook is checked by
// `claude plugin validate` (it lists ui.close{id=session-board}) and by hand; this covers the timer's lifecycle.
test('the board re-reads on a timer while the pane is up and stops when it is closed', async ($, on) => {
  const { clock } = host(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }))
  await begin($)
  await run($, 'open') // the pane is up: the timer runs
  const atOpen = calls.git
  await clock.advance(16_000)
  await clock.advance(0)
  expect(calls.git).toBeGreaterThan(atOpen)
  await run($, 'close')
  const atClose = calls.git
  await clock.advance(60_000)
  await clock.advance(0)
  expect(calls.git).toBe(atClose)
})

test('session start does not wait for git or the repo scan', async ($, on) => {
  let release = () => {}
  host(on, project(), '## main\n', new Promise<void>(r => (release = r)))
  await begin($) // would never return if it waited for git
  release()
})

test("a subagent's final answer is transcript text and is never drawn", async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'z1' }))
  on('turn.complete', () => ({ text: '' }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Read the env file'))
  await $.turn.complete({ turnId: 'Z', agentId: 'z1', reason: 'answer', durationMs: 1, answer: 'the key is sk-live-0123456789abcdef' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await ui.press({ key: 'card-z1' })
  expect(await ui.find({ text: /sk-live/ })).toBeUndefined()
  expect(await ui.find({ text: /^general-purpose · Sonnet 5\.5 · done · 0 steps$/ })).toBeDefined() // the expanded card itself is there
  await ui.unmount()
})

test('seated inline above the prompt the pane is the band: the Status row and one AI-SDLC line', async ($, on) => {
  host(on)
  await begin($)
  const inline = { ...pane(100), props: { ...pane(100).props, placement: 'inline' as const } }
  const ui = await $.ui.mount({ ...inline, surface: 'terminal' })
  expect(await ui.find({ key: 'band-main' })).toBeDefined()
  expect(await rowOf(ui, 'band-progress')).toBe('AI-SDLC ✔─✔─✔─✔─✔─◉─○─○  now Review · next Ship')
  expect(await ui.find({ text: /^Tasks$/ })).toBeUndefined() // not the full card
  await ui.unmount()
})

test('the main panel keeps the burnt-orange border; the other panels are sky blue, except the red of an agent that ran out of tokens', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'b1' }))
  on('tool.check', () => ({ decision: 'allow' }))
  await begin($)
  await $.agent.spawn(spawn('general-purpose', 'Look around'))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'k1' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...pane(100), surface })
    const colours = [...JSON.stringify(await ui.drawn()).matchAll(/"borderColor":"([^"]+)"/g)].map(m => m[1])
    expect(colours.length).toBeGreaterThanOrEqual(4) // main, AI-SDLC, an agent card, the gate
    expect(colours[0]).toBe('claude') // the main panel: the theme's burnt orange
    expect(new Set(colours.slice(1))).toEqual(new Set(['#87ceeb'])) // AI-SDLC, agent card, gate: sky blue
    await ui.unmount()
  }
})
