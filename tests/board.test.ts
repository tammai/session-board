import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { REVIEW, SHIPPED as SHIPPED_BAND, band as bandFile, steps } from './fixtures/sdlc'

// ---------------------------------------------------------------- a mocked host

const ROOT = '/work/session-board'
const LEDGER = '/home/me/.claude/statusline-cost/46ec31dcd0eb7eec' // sha1(ROOT)[:16]
const ID = '2026-10-19-open-change'

const SHIPPED = SHIPPED_BAND.activeId as string

const project = (): Record<string, string> => ({
  [`${ROOT}/.sdlc/local/band.json`]: bandFile(REVIEW),
  [`${LEDGER}/sess-0`]: '{"base": 10.0, "last": 4.8}',
})

const MIN = 60_000
const USAGE = {
  context: { window: 200_000, percent: 42, tokens: 84_000 },
  cost: { usd: 1.23 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: new Date(43 * MIN).toISOString() }],
}

/** The engine resolves a path to the platform's form (`C:\work\x` on Windows); the fake project keys are POSIX. */
const posix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

/** How many files the host has been asked for or to list, so a test can tell when the scan has settled. */
let reads = 0

/** Answers what sits beneath the plugin: the session, its files and the environment. */
const host = (on: On, files: Record<string, string> = project(), hold?: Promise<unknown>, settings: Record<string, unknown> = {}) => {
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
  on('fs.read', async (_$, e) => {
    reads++
    if (hold) await hold
    const text = files[posix(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_$, e) => {
    reads++
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
  on('turn.step', async function* () {
    return { turnId: 'S1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return { clock }
}

/** The band above the prompt, as the host mounts it. */
const band = (bodyColumns: number, hasSurvey = false) => ({
  plugin: 'session-board',
  component: 'AbovePrompt' as const,
  requestId: 'band',
  props: { hasSurvey, isWorking: false, maxRows: 8, bodyColumns, scroll: { offset: 0, bodyRows: 8 }, view: {} },
})

type Test$ = Engine

const begin = async ($: Test$) => {
  await $.session.start({ cwd: ROOT, surface: 'terminal' } as never)
  // The repo scan runs after the start returns, and the terminal and the desktop draw nothing until it has read: wait until the reads stop.
  for (let quiet = 0, seen = -1; quiet < 3; await new Promise(r => setTimeout(r, 10))) {
    quiet = reads === seen ? quiet + 1 : 0
    seen = reads
  }
}

/** One main-loop request, so the board learns the effort level. */
const oneStep = async ($: Test$) => {
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)
  for await (const _ of s) void _
  await s.result
}

const run = ($: Test$, args: string) => $.command.run({ command: 'session-board', args } as never) as Promise<{ text: string }>

const SURFACES = ['terminal', 'desktop'] as const

type Mounted = { find: (q: { key?: string; type?: string; text?: RegExp }) => Promise<{ text?: string; props: Record<string, unknown> } | undefined> }
const rowOf = async (ui: Mounted, key: string) => (await ui.find({ key }))?.text ?? ''

/** The colours the band gives to the values on its AI-SDLC line. */
const NOW = '#f07623' // the step now: orange, like its mark
const BLUE = '#87ceeb' // the step next and the tier: sky blue, like the title
const ACCENT = '#4a9fd8' // the same on the desktop: a deeper blue that reads on a light background too
const DONE = '#59c9a5' // the done count: green, like a step done

// ---------------------------------------------------------------- the band

test('the band is above the prompt from the start: one AI-SDLC line in an orange border, as on the desktop', async ($, on) => {
  host(on)
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  // the title, the step now, the tier and the change, each after a dot; then the eight steps as a progress line
  expect(await rowOf(ui, 'band-panel')).toBe(`AI-SDLC · Review · Tier M · ${ID}✔─✔─✔─✔─✔─◉─○─○`)
  expect(await ui.find({ key: 'band-main' })).toBeUndefined() // no main line (model, limits, spend)
  expect(await ui.find({ text: /Opus|ctx|\$|now |next /i })).toBeUndefined() // and no labels, no second line
  expect((await ui.find({ text: /^AI-SDLC$/ }))?.props.color).toBe(BLUE) // the line is titled
  for (const [value, color] of [['Review', NOW], ['M', BLUE]]) expect([value, (await ui.find({ type: 'Text', text: new RegExp(`^${value}$`) }))?.props.color]).toEqual([value, color])
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"borderStyle":"round"')
  expect(drawn).toContain('"borderColor":"claude"')
  expect(drawn).not.toContain('"role":"dismiss"') // the terminal has no close control: /session-board close
  await ui.unmount()
})

test('where the surface draws SVG (the editor) the band is a designed card: gauges as bars, the pipeline as one drawing, the tier as a chip', async ($, on) => {
  host(on)
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'vscode' })
  const colorOf = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.props.color
  // row 1: state, model and effort, three limits as a bar, a percent in its tone and the time to the reset, the spend
  expect(await rowOf(ui, 'band-main')).toBe('○IdleOpus 5.5N/Actx42%5h85%43m7dN/A$1.23 / $16.03')
  expect(await colorOf('42%')).toBe(DONE) // calm
  expect(await colorOf('85%')).toBe('#d81e5b') // from 80: red
  expect((await ui.find({ type: 'Text', text: /^Opus 5.5$/ }))?.props.weight).toBe('semibold')
  const drawn = JSON.stringify(await ui.drawn())
  for (const alt of ['ctx 42%', '5h 85%']) expect(drawn).toContain(`"alt":"${alt}"`)
  // row 2: the pipeline is one SVG whose alt says every step, then now and next in small caps labels, the change and its tier
  expect(drawn).toContain('"alt":"AI-SDLC: intent done, spec done, plan done, build done, verify done, review current, ship todo, knowledge todo"')
  expect(await rowOf(ui, 'band-progress')).toBe(`AI-SDLCNowReview NextShipTier M${ID}`)
  expect([await colorOf('Review'), await colorOf('Ship'), await colorOf('AI-SDLC')]).toEqual([NOW, ACCENT, ACCENT])
  const tier = await ui.find({ type: 'Text', text: /^M$/ }) // the tier is plain text, no background, in the same font as the rest
  expect([tier?.props.color, tier?.props.backgroundColor]).toEqual([ACCENT, undefined])
  expect(JSON.stringify(await ui.drawn())).not.toContain('"size"') // and one size of type throughout
  const id = await ui.find({ type: 'Text', text: new RegExp(`^${ID}$`) })
  expect([id?.props.mono, id?.props.wrap]).toEqual([undefined, 'truncate']) // the change id in the same face as the rest, cut at the edge
  expect(drawn).toContain('"borderColor":"claude"')
  await ui.unmount()
})

test('close hides the band and open shows it again; a survey takes its place; an unknown word gives the usage', async ($, on) => {
  host(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never) // what sits beneath
  await begin($)
  const shown = async (hasSurvey = false) => {
    const ui = await $.ui.mount({ ...band(100, hasSurvey), surface: 'terminal' })
    const isBoard = (await ui.find({ key: 'band-panel' })) !== undefined
    const isEngine = (await ui.find({ text: /^the engine band$/ })) !== undefined
    await ui.unmount()
    return { isBoard, isEngine }
  }
  expect(await shown()).toEqual({ isBoard: true, isEngine: false })
  expect((await run($, 'close')).text).toMatch(/hidden/i)
  expect(await shown()).toEqual({ isBoard: false, isEngine: true }) // the board yields
  expect((await run($, 'open')).text).toMatch(/shown/i)
  expect(await shown()).toEqual({ isBoard: true, isEngine: false })
  expect(await shown(true)).toEqual({ isBoard: false, isEngine: true }) // a survey is up
  expect((await run($, 'bogus')).text).toContain('open|close')
})

test("the effort shows before the first request, from the settings, and a request's own value replaces it", async ($, on) => {
  host(on, project(), undefined, { modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } })
  await begin($)
  const before = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(before, 'band-main')).toContain('Opus 5.5xhigh')
  await before.unmount()
  await oneStep($) // the request says high
  const after = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(after, 'band-main')).toContain('Opus 5.5high')
  await after.unmount()
})

test('the editor band says working during a turn and idle after it', async ($, on) => {
  host(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await begin($)
  await $.turn.start({ text: 'go', turnId: 'T1' } as never)
  const working = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(working, 'band-main')).toMatch(/^●Working/)
  await working.unmount()
  await $.turn.complete({ turnId: 'T1', reason: 'answer', durationMs: 1, answer: '' } as never)
  const idle = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(idle, 'band-main')).toMatch(/^○Idle/)
  await idle.unmount()
})

test('with nothing readable the editor band still draws, every missing value as N/A', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-board' } }) as never)
  on('session.start', () => ({ cwd: ROOT }) as never)
  on('ui.status', () => ({ value: undefined }))
  await begin($)
  const desktop = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(desktop, 'band-main')).toBe('○IdleN/AN/ActxN/A5hN/A7dN/AN/A / N/A')
  expect(await desktop.find({ key: 'band-progress' })).toBeUndefined()
  await desktop.unmount()
})

// ---------------------------------------------------------------- AI-SDLC

test('a build of several steps is one count after the pipeline: the steps that passed out of all of them', async ($, on) => {
  const files = project()
  const rows = Array.from({ length: 9 }, (_, i) => ({ step: String(i), rounds: 1, model: 'sonnet', verdict: i < 8 ? 'pass' : null }))
  files[`${ROOT}/.sdlc/local/band.json`] = bandFile({ ...REVIEW, next: 'build', stages: steps('done', 'done', 'done', 'current', 'todo', 'todo', 'todo', 'todo'), build: rows })
  host(on, files)
  await begin($)
  const terminal = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(terminal, 'band-panel')).toBe(`AI-SDLC · Build · Tier M · ${ID}✔─✔─✔─◉─○─○─○─○  8/9`)
  for (const [value, color] of [['Build', NOW], ['8', DONE], ['M', BLUE]]) expect([value, (await terminal.find({ type: 'Text', text: new RegExp(`^${value}$`) }))?.props.color]).toEqual([value, color])
  await terminal.unmount()
  // where SVG is drawn the count is a small bar and `8/9`, the 8 in green
  const desktop = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await rowOf(desktop, 'done')).toBe('8/9')
  expect(JSON.stringify(await desktop.drawn())).toContain('"alt":"8 of 9 build steps passed"')
  for (const [value, color] of [['Build', NOW], ['Verify', ACCENT], ['8', DONE]]) expect([value, (await desktop.find({ type: 'Text', text: new RegExp(`^${value}$`) }))?.props.color]).toEqual([value, color])
  await desktop.unmount()
  // the desktop's line puts the count after the pipeline, the passed number in green
  const panel = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await rowOf(panel, 'band-panel')).toBe(`AI-SDLC·Build·Tier M·${ID}8/9×`)
  expect((await panel.find({ type: 'Text', text: /^8$/ }))?.props.color).toBe(DONE)
  await panel.unmount()
})

test('a tier S change shows its spec and review as skipped; a closed one says closed', async ($, on) => {
  const files = project()
  files[`${ROOT}/.sdlc/local/band.json`] = bandFile(SHIPPED_BAND)
  host(on, files)
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(ui, 'band-panel')).toBe(`AI-SDLC · Tier S · ${SHIPPED} Closed (shipped)✔─⊖─✔─✔─✔─⊖─✔─○`) // nothing is in progress: the outcome follows the change
  await ui.unmount()
  // on the desktop a closed change has no step now: the dots separate what there is, and its outcome follows the change
  const desktop = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await rowOf(desktop, 'band-panel')).toBe(`AI-SDLC·Tier S·${SHIPPED}Closed (shipped)×`)
  await desktop.unmount()
})

test('a project with no ai-sdlc files has no band in the terminal, as on the desktop; the editor keeps its card', async ($, on) => {
  host(on, { [`${ROOT}/README.md`]: '# hi' })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never)
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /^the engine band$/ })).toBeDefined()
  expect(await ui.find({ key: 'band-panel' })).toBeUndefined()
  await ui.unmount()
  const editor = await $.ui.mount({ ...band(100), surface: 'vscode' })
  expect(await editor.find({ text: /^AI-SDLC/ })).toBeUndefined()
  expect(await editor.find({ key: 'band-main' })).toBeDefined() // the rest of the card is unaffected
  await editor.unmount()
})

test('a band file with no active change reads "no active change"; an .sdlc folder with no band file has no band', async ($, on) => {
  host(on, { [`${ROOT}/.sdlc/local/band.json`]: bandFile({ activeId: null }) })
  await begin($)
  for (const [surface, key, text] of [['terminal', 'band-panel', 'AI-SDLC no active change'], ['vscode', 'band-progress', 'AI-SDLCno active change']] as const) {
    const ui = await $.ui.mount({ ...band(100), surface })
    expect(await rowOf(ui, key)).toBe(text)
    await ui.unmount()
  }
})

test('an .sdlc folder from an ai-sdlc that writes no band file shows no band, and so does a file of another version', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.sdlc/config.json`]: '{}' }
  host(on, files)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never)
  await begin($)
  const none = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await none.find({ text: /^the engine band$/ })).toBeDefined()
  await none.unmount()
  files[`${ROOT}/.sdlc/local/band.json`] = JSON.stringify({ version: 2, ...REVIEW })
  await $.turn.complete({ turnId: 'T1', reason: 'answer', durationMs: 1, answer: '' } as never)
  const other = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await other.find({ key: 'band-panel' })).toBeUndefined()
  await other.unmount()
})

// ---------------------------------------------------------------- the desktop

test('on the desktop the band is one line of AI-SDLC with no border of its own and a close control that hides it', async ($, on) => {
  host(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never) // what sits beneath
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'desktop' })
  const colorOf = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.props.color
  // the title, the step now, the tier, the change, the close control; the small pipeline is a drawing between the last two
  expect(await rowOf(ui, 'band-panel')).toBe(`AI-SDLC·Review·Tier M·${ID}×`)
  expect(await ui.find({ key: 'band-main' })).toBeUndefined() // no main line (model, limits, spend)
  expect(await ui.find({ text: /Opus|ctx|\$|NOW|NEXT|Intent|Knowledge/ })).toBeUndefined() // and no labels, no second line
  expect([await colorOf('AI-SDLC'), await colorOf('Review'), await colorOf('M')]).toEqual([ACCENT, NOW, ACCENT])
  const drawn = JSON.stringify(await ui.drawn())
  const small = '"alt":"AI-SDLC: intent done, spec done, plan done, build done, verify done, review current, ship todo, knowledge todo"'
  expect(drawn).toContain(small)
  expect(drawn.match(/"type":"Svg"/g)).toHaveLength(1) // the one pipeline drawing
  expect(drawn.indexOf(small)).toBeLessThan(drawn.indexOf('"role":"dismiss"')) // before the close control
  expect(drawn).not.toContain('borderStyle') // the host frames the band; a border of ours would double it
  expect(drawn).not.toContain('"size"') // one size of type throughout
  expect(drawn).toContain('"role":"dismiss"') // and draws its close control at the trailing edge
  expect(drawn).toContain('"label":"×"') // the control is always ×, as a label and as its face
  expect((await ui.find({ type: 'Text', text: /^×$/ }))?.text).toBe('×')

  await ui.press({ key: 'close' }) // the close control
  await ui.unmount()
  const after = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await after.find({ text: /^the engine band$/ })).toBeDefined() // the band is gone, the engine's draws
  expect(await after.find({ key: 'band-panel' })).toBeUndefined()
  await after.unmount()
  await run($, 'open') // the command brings it back
  const again = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await again.find({ key: 'band-panel' })).toBeDefined()
  await again.unmount()
})

test('on the desktop a project with no ai-sdlc files has no band at all', async ($, on) => {
  host(on, { [`${ROOT}/README.md`]: '# hi' })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', children: ['the engine band'] }) as never)
  await begin($)
  const ui = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await ui.find({ text: /^the engine band$/ })).toBeDefined()
  expect(await ui.find({ key: 'band-panel' })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- when it reads

test('a turn end always re-reads the repo, even right after another read', async ($, on) => {
  const files = project()
  host(on, files)
  on('turn.complete', () => ({ text: '' }))
  await begin($)
  files[`${ROOT}/.sdlc/local/band.json`] = bandFile({ activeId: null })
  await $.turn.complete({ turnId: 'T1', reason: 'answer', durationMs: 1, answer: '' } as never)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(ui, 'band-panel')).toBe('AI-SDLC no active change')
  await ui.unmount()
})

test('a call that can change files re-reads the repo, at most once every two seconds', async ($, on) => {
  const files = project()
  const { clock } = host(on, files)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await begin($)
  await clock.advance(3000) // past the debounce of the read at the start
  files[`${ROOT}/.sdlc/local/band.json`] = bandFile({ activeId: null })
  await $.tool.call({ tool: 'Edit', input: { file_path: '/a' }, tool_use_id: 'k1' } as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await rowOf(ui, 'band-panel')).toBe('AI-SDLC no active change')
  await ui.unmount()
})

test('session start does not wait for the repo scan', async ($, on) => {
  let release = () => {}
  host(on, project(), new Promise<void>(r => (release = r)))
  await begin($) // would never return if it waited for the files
  release()
})
