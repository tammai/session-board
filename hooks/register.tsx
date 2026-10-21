import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Main, Sdlc, Status, Usage, View } from '../types'
import { bandRow } from './board'
import {
  DEFAULT_MAIN,
  DEFAULT_STATUS,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  PALETTES,
  SCHEMA_VERSION,
  effortFromSettings,
  limitOf,
  normalize,
  normalizeSdlc,
  parseConfig,
} from './core'
import { ioOf, readSdlc, safe, trackProjectCost } from './sources'

/** Re-read the repo at most this often on events. */
const MIN_GAP_MS = 2000

// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'session-board', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'session-board', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'session-board', key: 'usage' } as const, DEFAULT_USAGE)
const status = atom({ plugin: 'session-board', key: 'status' } as const, DEFAULT_STATUS)
const sdlc = atom({ plugin: 'session-board', key: 'sdlc' } as const, null)
const view = atom({ plugin: 'session-board', key: 'view' } as const, DEFAULT_VIEW)

// Every read goes through these, so a value saved under an older shape still reads.
const getMain = async ($: EngineInterface): Promise<Main> => normalize(DEFAULT_MAIN, await read($, main))
const getUsage = async ($: EngineInterface): Promise<Usage> => {
  const u = normalize(DEFAULT_USAGE, await read($, usage))
  return { ...u, limits: Array.isArray(u.limits) ? u.limits : [] }
}
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
    costUsd: u.cost?.usd ?? null,
    limits: u.rateLimits.map(limitOf),
  }))
}

// ---------------------------------------------------------------- hooks

let inFlight: Promise<void> | null = null
let lastRefreshAt: number | null = null

async function setShown($: EngineInterface, isShown: boolean) {
  await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), isShown }))
}

/** One read of the project's spend and the ai-sdlc files, written to state where it changed. */
async function readSources($: EngineInterface) {
  const root = await safe(() => $.session.root())
  const io = ioOf($)
  // The session's id and spend so far feed the board's own project ledger (the statusline sanitises the id the same way).
  const sessionId = ((await safe(() => $.session.id())) ?? '').replace(/[^A-Za-z0-9_-]/g, '') || null
  const sessionCost = (await getUsage($)).costUsd
  const [projectCost, found] = await Promise.all([root ? trackProjectCost(io, root, sessionId, sessionCost) : null, root ? readSdlc(io, root) : { sdlc: null, note: 'no-sdlc' as const }])
  const next: Status = { projectCost, note: found.note }
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

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-board',
      description: 'Session board: a band above the prompt with the model, limits and spend, and AI-SDLC progress',
      argumentHint: '[open|close]',
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
    // The repo scan is not worth the first prompt's wait: the first draw may read N/A for a moment.
    later($, true)
    return started
  })

  on('command.run', { command: 'session-board' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
    if (verb === 'close') {
      await setShown($, false)
      return { text: 'Session board hidden. /session-board open shows it.' }
    }
    if (verb === '' || verb === 'open') {
      await setShown($, true)
      return { text: 'Session board shown above the prompt.' }
    }
    return { text: 'Usage: /session-board [open|close]' }
  })

  on('turn.start', async ($, e, next) => {
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model and effort are known when its request starts.
    if (!e.agentId) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: e.model, effort: e.effort !== undefined && e.effort !== null ? String(e.effort) : x.effort }
      })
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      costUsd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(limitOf),
    }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // A call that can change files is a reason to look again.
    if (EDIT_TOOLS.has(e.tool) || e.tool === 'Bash' || e.tool === 'PowerShell') later($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      // The end of a turn is when the files have settled: read them whatever the debounce says.
      await refreshSources($, true)
    }
    return done
  })

  // ---------------------------------------------------------------- drawing

  // The band: one AI-SDLC line above the prompt (the desktop app and the terminal), or a two-row card with the model, limits and spend
  // (the editor, the phones), unless it was closed or a survey is up. Closing it on the desktop is a press of its close control.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await getView($)
    if (e.props.hasSurvey || !(v.isShown ?? cfg.openOnStart)) return next(e)
    const els = $.ui.resolve(e)
    const [m, u, s, sd, now] = await Promise.all([getMain($), getUsage($), getStatus($), getSdlc($), $.clock.now()])
    // the desktop and the terminal have nothing to draw until the project has been read, and no line of the band without ai-sdlc's file
    // unless there is a reason to give: then the band says why, in a line of its own
    if (!sd && !s.note && (e.surface === 'desktop' || e.surface === 'terminal')) return next(e)
    return bandRow({ els, C, main: m, usage: u, status: s, now, sdlc: sd, W: Math.max(40, e.props.bodyColumns), surface: e.surface, onClose: () => void setShown($, false) })
  })
}
