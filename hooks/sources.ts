// The only file that touches `$.fs` and `$.env`. Every read returns a value or null, and null
// is drawn as N/A: a missing file, bad JSON or no home directory never throws out of here.
import type { EngineInterface } from 'claude-code'

import type { Sdlc } from '../types'
import { BAND_FILE, parseBand } from './sdlc'
import { applySession, normalizeLedger, normalizeProject, projectKey, projectTotal } from './statusline'
import type { Ledger } from './statusline'

/** What the readers need from the host; `ioOf` fills it from `$`, tests fill it from memory. */
export type Io = {
  read(path: string): Promise<string>
  list(path: string): Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  homeDir(): Promise<string | undefined>
  configDir(): Promise<string | undefined>
  /** The host's store, kept across sessions: the board's own cost ledger lives here. */
  storeGet(key: string): Promise<unknown>
  storeSet(key: string, value: unknown): Promise<void>
}

// The env names are string literals: `claude plugin validate` reads them off the source.
export function ioOf($: EngineInterface): Io {
  return {
    read: async path => (await $.fs.read(path)) as string,
    list: async path => (await $.fs.list(path)).map(e => ({ name: e.name, kind: e.kind })),
    // HOME is an empty string on Windows, so it counts as unset.
    homeDir: async () => (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || undefined,
    configDir: async () => (await $.env.get('CLAUDE_CONFIG_DIR')) || undefined,
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
  }
}

/** The result of `work`, or null when it throws or rejects. */
export const safe = async <T>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- cost

/**
 * The statusline's old per-session records, `<config>/statusline-cost/<hash>/<session>` holding `{base, last}`,
 * as ledger entries. Read once per project, when the board first sees it; null where there is nothing to read.
 */
const readStatuslineRecords = async (io: Io, projectDir: string): Promise<Ledger['sessions'] | null> => {
  const config = await safe(io.configDir)
  const home = await safe(io.homeDir)
  const base = config ? normalizeProject(config) : home ? `${normalizeProject(home)}/.claude` : null
  if (!base) return null
  const dir = `${base}/statusline-cost/${await projectKey(projectDir)}`
  const entries = await safe(() => io.list(dir))
  if (!entries) return null
  const sessions: Ledger['sessions'] = {}
  for (const e of entries) {
    if (e.kind !== 'file' || e.name.startsWith('.')) continue
    const text = await safe(() => io.read(`${dir}/${e.name}`))
    if (text === null) continue
    const rec = await safe(async () => JSON.parse(text) as unknown)
    const { base: b, last } = (typeof rec === 'object' && rec !== null ? rec : {}) as { base?: unknown; last?: unknown }
    if (typeof b === 'number' && Number.isFinite(b) && typeof last === 'number' && Number.isFinite(last)) sessions[e.name] = [b, last]
  }
  return sessions
}

/**
 * The project's total spend, kept by the board itself in the host's store, one record per session and
 * counted like statusline.sh. The first time a project is seen the statusline's records are copied in
 * (a session already in the ledger is not overwritten); after that they are never read again.
 * `sessionTotal` is this session's spend so far; null leaves the ledger as it is. Null when nothing is known.
 */
export const trackProjectCost = async (io: Io, projectDir: string, sessionId: string | null, sessionTotal: number | null): Promise<number | null> => {
  const key = `cost-${await projectKey(projectDir)}`
  let ledger = normalizeLedger(await safe(() => io.storeGet(key)))
  const before = JSON.stringify(ledger)
  if (!ledger.imported) {
    const old = await readStatuslineRecords(io, projectDir)
    ledger = { imported: true, sessions: { ...old, ...ledger.sessions } }
  }
  if (sessionId && sessionTotal !== null) ledger = applySession(ledger, sessionId, sessionTotal)
  if (JSON.stringify(ledger) !== before) await safe(() => io.storeSet(key, ledger))
  return projectTotal(ledger)
}

// ---------------------------------------------------------------- ai-sdlc

/** The AI-SDLC line's data, as ai-sdlc wrote it to `.sdlc/local/band.json`; null when there is no such file, or it is not one the board knows. */
export const readSdlc = async (io: Io, root: string): Promise<Sdlc | null> => {
  const file = await safe(() => io.read(`${normalizeProject(root)}/${BAND_FILE}`))
  if (file === null) return null
  return parseBand(await safe(async () => JSON.parse(file) as unknown))
}
