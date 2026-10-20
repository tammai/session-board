import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, Bucket, ChangeSummary, Check, Gate, Layout, Main, Sdlc, Status, Usage, View } from '../types'
import { bandRow, boardTitle, sdlcPanel } from './board'
import { mainPanel } from './main'
import { money } from './statusline'
import {
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_STATUS,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  PALETTES,
  SCHEMA_VERSION,
  applyStep,
  bucketOf,
  cardTitle,
  clean,
  describeInput,
  effortFromSettings,
  limitOf,
  listOf,
  normalize,
  normalizeCard,
  uniqueCards,
  normalizeGate,
  normalizeSdlc,
  noteTool,
  parseConfig,
  recordCheck,
  gateSummary,
  settleCheck,
  shorten,
  widthOf,
} from './core'
import { agentsPanel, expandedPanel, gatePanel, svgLanes } from './panels'
import { ioOf, readGit, readSdlc, safe, trackProjectCost } from './sources'

const PANE = 'session-board'
const TITLE = 'Session Board'
const PANE_COLUMNS = 66
/** Re-read the repo at most this often on events, and this often while the board is showing. */
const MIN_GAP_MS = 2000
const TICK_MS = 15_000

// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'session-board', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'session-board', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'session-board', key: 'usage' } as const, DEFAULT_USAGE)
const status = atom({ plugin: 'session-board', key: 'status' } as const, DEFAULT_STATUS)
const sdlc = atom({ plugin: 'session-board', key: 'sdlc' } as const, null)
const gate = atom({ plugin: 'session-board', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'session-board', key: 'agents' } as const, [])
const view = atom({ plugin: 'session-board', key: 'view' } as const, DEFAULT_VIEW)

// Every read goes through these, so a value saved under an older shape still reads.
const getMain = async ($: EngineInterface): Promise<Main> => normalize(DEFAULT_MAIN, await read($, main))
const getUsage = async ($: EngineInterface): Promise<Usage> => {
  const u = normalize(DEFAULT_USAGE, await read($, usage))
  return { ...u, limits: Array.isArray(u.limits) ? u.limits : [] }
}
const getGate = async ($: EngineInterface): Promise<Gate> => normalizeGate(await read($, gate))
const getCards = async ($: EngineInterface): Promise<AgentCard[]> => uniqueCards(listOf<unknown>(await read($, agents)).map(normalizeCard))
const getView = async ($: EngineInterface): Promise<View> => normalize(DEFAULT_VIEW, await read($, view))
const getSdlc = async ($: EngineInterface): Promise<Sdlc | null> => normalizeSdlc(await read($, sdlc))
const getStatus = async ($: EngineInterface): Promise<Status> => normalize(DEFAULT_STATUS, await read($, status))

/** The session's context, cost and limits, read from the host; a host without them leaves the values unknown. */
async function noteUsage($: EngineInterface) {
  const u = await safe(() => $.session.usage())
  if (!u) return
  await update($, usage, x => ({
    ...normalize(DEFAULT_USAGE, x),
    pct: u.context.percent ?? null,
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    costUsd: u.cost?.usd ?? null,
    limits: u.rateLimits.map(limitOf),
  }))
}

const folderOf = (path: string) => clean(path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '') || null

// ---------------------------------------------------------------- hooks

// Closed changes are not read twice in a session; the cache lives with this module.
let sdlcCache: Record<string, ChangeSummary> = {}
let inFlight: Promise<void> | null = null
let lastRefreshAt: number | null = null
let ticker: { cancel: () => void } | null = null
// tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
const callLoop = new Map<string, string | null>()

/** The board's per-session records start over: agents, permission checks, the open drill-downs. */
async function resetBoard($: EngineInterface) {
  await update($, agents, () => [])
  await update($, gate, () => DEFAULT_GATE)
  // The layout is a choice, not a record: it stays.
  await update($, view, v => ({ ...DEFAULT_VIEW, layout: normalize(DEFAULT_VIEW, v).layout }))
}

async function setLayout($: EngineInterface, layout: Layout | null) {
  await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
}

/** One read of git, the project's spend and the ai-sdlc files, written to state where it changed. */
async function readSources($: EngineInterface) {
  const [root, cwd] = await Promise.all([safe(() => $.session.root()), safe(() => $.session.cwd())])
  const io = ioOf($)
  const where = root ?? cwd
  // The session's id and spend so far feed the board's own project ledger (the statusline sanitises the id the same way).
  const sessionId = ((await safe(() => $.session.id())) ?? '').replace(/[^A-Za-z0-9_-]/g, '') || null
  const sessionCost = (await getUsage($)).costUsd
  const [git, projectCost, found] = await Promise.all([
    cwd ? readGit(io, cwd) : { branch: null, dirty: null, added: null, removed: null },
    root ? trackProjectCost(io, root, sessionId, sessionCost) : null,
    root ? readSdlc(io, root, sdlcCache) : { sdlc: null as Sdlc | null, cache: sdlcCache },
  ])
  sdlcCache = found.cache
  const next: Status = {
    folder: where ? folderOf(where) : null,
    branch: git.branch,
    dirty: git.dirty,
    added: git.added,
    removed: git.removed,
    projectCost,
  }
  if (JSON.stringify(next) !== JSON.stringify(await getStatus($))) await update($, status, () => next)
  if (JSON.stringify(found.sdlc) !== JSON.stringify(await read($, sdlc))) await update($, sdlc, () => found.sdlc)
}

/**
 * Re-reads the sources. One at a time: an unforced call while one runs, or within MIN_GAP_MS of the last, is
 * dropped; a forced one (the start, a turn's end) waits for the one running and then reads again.
 */
async function refreshSources($: EngineInterface, isForced = false) {
  while (inFlight) {
    if (!isForced) return
    await inFlight.catch(() => undefined)
  }
  const now = await $.clock.now()
  if (!isForced && lastRefreshAt !== null && now - lastRefreshAt < MIN_GAP_MS) return
  inFlight = readSources($).finally(() => {
    inFlight = null
    lastRefreshAt = now
  })
  await inFlight
}

function later($: EngineInterface, isForced = false) {
  void refreshSources($, isForced).catch(() => undefined)
}

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  // The project's name titles the board; read here, not from state, so a first open is not waiting on the refresh.
  const root = await safe(() => $.session.root())
  const opened = await $.ui.open({ id: PANE, title: ((root && folderOf(root)) || TITLE).toUpperCase(), columns: PANE_COLUMNS, rows: 8 })
  if (opened.isPlaced && !ticker) ticker = $.clock.every(TICK_MS, () => later($))
  return opened
}

async function closePane($: EngineInterface) {
  ticker?.cancel()
  ticker = null
  await $.ui.close({ id: PANE })
}

/** Opens the pane; where there is no room for one (a narrow terminal), the compact band is the board. */
async function showBoard($: EngineInterface): Promise<{ isPlaced: boolean; reason: string }> {
  await setLayout($, null)
  const opened = await openPane($)
  if (opened.isPlaced) return { isPlaced: true, reason: '' }
  // An unseated pane waits for a wider terminal; withdraw it, or it would appear later beside the band.
  await closePane($)
  await setLayout($, 'compact')
  return { isPlaced: false, reason: opened.reason }
}


export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-board',
      description: 'Session board: a statusline-style row, AI-SDLC progress, subagents and permission checks',
      argumentHint: '[open|close|compact|reset]',
    })
    const started = await next(e)
    await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
    const model = await safe(() => $.session.model())
    if (model) await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), model }))
    // A request says the effort when it starts; until then the settings are the best answer there is.
    const configured = effortFromSettings(await safe(() => $.settings.read()), model)
    if (configured) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return x.effort ? x : { ...x, effort: configured }
      })
    }
    await noteUsage($)
    // Git and the repo scan are not worth the first prompt's wait: the first draw may read N/A for a moment.
    later($, true)
    if (cfg.openOnStart && cfg.layout !== 'compact') void showBoard($).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'session-board' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
    if (verb === 'close') {
      await closePane($)
      await setLayout($, null)
      return { text: 'Session board closed.' }
    }
    if (verb === 'compact') {
      await closePane($)
      await setLayout($, 'compact')
      return { text: 'Session board: compact band above the prompt. /session-board open for the pane.' }
    }
    if (verb === 'reset') {
      await resetBoard($)
      return { text: 'Session board reset: agents and permission checks cleared.' }
    }
    if (verb === '' || verb === 'open') {
      const shown = await showBoard($)
      return { text: shown.isPlaced ? 'Session board opened.' : `The pane is not shown (${shown.reason}), so the compact band is.` }
    }
    return { text: 'Usage: /session-board [open|close|compact|reset]' }
  })

  // The person closes the pane with its close mark or ctrl+x x: nothing is showing, so the timer stops.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    ticker?.cancel()
    ticker = null
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await resetBoard($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // Compacting the main loop's context (a subagent's, or a precompute, is not the person's to count).
    if (!e.agentId && e.trigger !== 'precompute') {
      await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), compactions: normalize(DEFAULT_USAGE, x).compactions + 1 }))
    }
    return done
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model and effort are known when its request starts.
    if (!e.agentId) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: e.model, effort: e.effort !== undefined && e.effort !== null ? String(e.effort) : x.effort }
      })
      return yield* next(e)
    }
    const result = yield* next(e)
    const id = e.agentId
    const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
    await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const card: AgentCard = {
      ...normalizeCard({}),
      id: started.agentId,
      type: clean(e.name ?? e.subagentType),
      model: started.model,
      description: clean(e.description),
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => uniqueCards([...listOf<unknown>(list).map(normalizeCard), card]).slice(-24))
    return started
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      costUsd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(limitOf),
    }))
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const didRun = ran.deny === undefined
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const before = await getGate($)
    if (settleCheck(before, e.tool_use_id, didRun) !== before) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    if (e.agentId && e.tool !== 'Agent') {
      const id = e.agentId
      const note = { tool: e.tool, text: shorten(describeInput(e.tool, e), 64), isError: ran.isError === true || !didRun }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? noteTool(c, note) : c)))
    }
    // A call that can change files or the branch is a reason to look again.
    if (EDIT_TOOLS.has(e.tool) || e.tool === 'Bash' || e.tool === 'PowerShell') later($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (!id) {
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      // The end of a turn is when the files have settled: read them whatever the debounce says.
      await refreshSources($, true)
      return done
    }
    const now = await $.clock.now()
    const outcome = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    await update($, agents, list =>
      listOf<unknown>(list)
        .map(normalizeCard)
        .map(c => (c.id === id ? { ...c, status: outcome, endedAt: now } : c)),
    )
    return done
  })

  // ---------------------------------------------------------------- drawing

  // The compact band: the Status row and one AI-SDLC line, only while the layout is compact.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await getView($)
    if (e.props.hasSurvey || (v.layout ?? cfg.layout) !== 'compact') return next(e)
    const els = $.ui.resolve(e)
    const [m, u, s, sd, now] = await Promise.all([getMain($), getUsage($), getStatus($), getSdlc($), $.clock.now()])
    return bandRow({ els, C, main: m, usage: u, status: s, now, sdlc: cfg.panels.includes('sdlc') ? sd : null, W: Math.max(40, e.props.bodyColumns), surface: e.surface })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box } = els
    const [m, u, s, sd, g, cards, v, now] = await Promise.all([
      getMain($),
      getUsage($),
      getStatus($),
      getSdlc($),
      getGate($),
      getCards($),
      getView($),
      $.clock.now(),
    ])
    const W = Math.max(40, e.props.bodyColumns)
    // A blank row between the sections is for the desktop app; the terminal keeps its rows.
    const gap = e.surface === 'terminal' ? 0 : 1
    const isDesktop = e.surface !== 'terminal'
    // Seated inline above the prompt (rows are few) the pane is the band's content, not the whole board.
    if (e.props.placement === 'inline' && (v.layout ?? cfg.layout) === 'auto') {
      return bandRow({ els, C, main: m, usage: u, status: s, now, sdlc: cfg.panels.includes('sdlc') ? sd : null, W, surface: e.surface })
    }
    const isWide = (v.layout ?? cfg.layout) === 'wide' || ((v.layout ?? cfg.layout) === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const isMotion = cfg.motion && 'Client' in els
    const toggleCard = (id: string) => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))
    const toggleGate = (b: Bucket) => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))

    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const draw = (p: string, w: number) =>
      p === 'sdlc' ? (
        sd ? sdlcPanel({ els, C, sdlc: sd, W: w, surface: e.surface }) : null
      ) : p === 'agents' ? (
        cards.length === 0 ? null : (
          <Box key="agents-box" flexDirection="column" width={widthOf(e.surface, w)}>
            {agentsPanel({ els, C, cards, mainModel: m.model, maxCards: cfg.maxCards, w, now, viewed: e.props.view?.agentId ?? null, isMotion, onToggle: toggleCard, surface: e.surface })}
            {expandedPanel({ els, C, card: cards.find(c => c.id === v.expanded), w, surface: e.surface })}
          </Box>
        )
      ) : p === 'gate' ? (
        g.recent.length === 0 && gateSummary(g).total === 0 ? null : (
          gatePanel({ els, C, gate: g, open: v.gateOpen, w, onToggle: toggleGate, surface: e.surface })
        )
      ) : null
    const shown = cfg.panels.filter(p => p !== 'main' && draw(p, colW) !== null)
    // Two columns when docked wide: the AI-SDLC card on the left, the rest on the right.
    const left = shown.includes('sdlc') ? ['sdlc'] : shown.slice(0, Math.ceil(shown.length / 2))
    const right = shown.filter(p => !left.includes(p))
    const body =
      isWide && shown.length >= 2 ? (
        <Box key="columns" columnGap={2}>
          <Box key="column-left" flexDirection="column" width={isDesktop ? '50%' : colW}>
            {left.map(p => (
              <Box key={`panel-${p}`} flexDirection="column" marginTop={gap}>
                {draw(p, colW)}
              </Box>
            ))}
          </Box>
          <Box key="column-right" flexDirection="column" width={isDesktop ? '50%' : colW}>
            {right.map(p => (
              <Box key={`panel-${p}`} flexDirection="column" marginTop={gap}>
                {draw(p, colW)}
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" width={widthOf(e.surface, W)}>
          {shown.map(p => (
            <Box key={`panel-${p}`} flexDirection="column" marginTop={gap}>
              {draw(p, W)}
            </Box>
          ))}
        </Box>
      )
    return (
      <Box key="board-box" flexDirection="column" width={widthOf(e.surface, W)}>
        {boardTitle({ els, C, name: s.folder ?? TITLE, cost: `${money(u.costUsd)}/${money(s.projectCost)}` })}
        {cfg.panels.includes('main') ? (
          <Box key="panel-main" flexDirection="column" marginTop={gap}>
            {mainPanel({ els, C, main: m, usage: u, status: s, now, w: W, surface: e.surface })}
          </Box>
        ) : null}
        {body}
        {e.surface !== 'terminal' ? svgLanes({ els, cards, now }) : null}
      </Box>
    )
  })
}
