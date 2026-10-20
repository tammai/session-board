// The only file that touches `$.fs`, `$.process` and `$.env`. Every read returns a value or null, and null
// is drawn as N/A: a missing file, bad JSON, no git or no home directory never throws out of here.
import type { EngineInterface } from 'claude-code'

import type { ChangeSummary, Sdlc } from '../types'
import { clean } from './core'
import { MAX_ROUNDS, buildRows, checklistOf, parseBacklogOrder, parseFrontMatter, stageOf } from './sdlc'
import type { ChangeDocs, Meta } from './sdlc'
import { applySession, normalizeLedger, normalizeProject, projectKey, projectTotal } from './statusline'
import type { Ledger } from './statusline'

/** What the readers need from the host; `ioOf` fills it from `$`, tests fill it from memory. */
export type Io = {
  read(path: string): Promise<string>
  list(path: string): Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  run(argv: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string }>
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
    run: async (argv, cwd) => {
      const r = await $.process.run(argv, { cwd, timeoutMs: 5000 })
      return { exitCode: r.exitCode, stdout: r.stdout }
    },
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

const readJson = async (io: Io, path: string): Promise<Record<string, unknown> | null> => {
  const text = await safe(() => io.read(path))
  if (text === null) return null
  const parsed = await safe(async () => JSON.parse(text) as unknown)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

// ---------------------------------------------------------------- git and cost

// core.fsmonitor in a repo's own config names a program git would run: off, so reading git runs nothing of the repo's.
const GIT = ['git', '-c', 'core.fsmonitor=false', '--no-optional-locks']

/** The lines added and removed in a `git diff --numstat`; a binary file (`-`) has no counts. */
const sumNumstat = (text: string) => {
  let added = 0
  let removed = 0
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t/.exec(line)
    if (m) {
      added += Number(m[1])
      removed += Number(m[2])
    }
  }
  return { added, removed }
}

/**
 * The branch and changed files (`git status`) and the total lines added and removed against HEAD
 * (`git diff --numstat`, tracked files). Each part is null where git cannot say: no git, no commits yet.
 */
export const readGit = async (io: Io, cwd: string): Promise<{ branch: string | null; dirty: number | null; added: number | null; removed: number | null }> => {
  const [status, diff] = await Promise.all([
    safe(() => io.run([...GIT, 'status', '--porcelain', '-b'], cwd)),
    // No external diff driver or textconv: they are programs a repo's config names.
    safe(() => io.run([...GIT, 'diff', '--numstat', '--no-ext-diff', '--no-textconv', 'HEAD'], cwd)),
  ])
  const counts = diff && diff.exitCode === 0 ? sumNumstat(diff.stdout) : { added: null, removed: null }
  if (!status || status.exitCode !== 0) return { branch: null, dirty: null, ...counts }
  let branch: string | null = null
  let dirty = 0
  for (const line of status.stdout.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const name = line.slice(3).split('...')[0] ?? ''
      branch = name === 'HEAD (no branch)' ? 'detached' : clean(name.replace(/^No commits yet on /, '')) || null
    } else if (line.trim() !== '') dirty += 1
  }
  return { branch, dirty, ...counts }
}

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

const KINDS = ['intent', 'design', 'ui', 'spec', 'plan', 'verify', 'review'] as const

/** A change's documents' front matter; a missing file is absent, a file with none is absent too. */
const readDocs = async (io: Io, dir: string, only: readonly (typeof KINDS)[number][] = KINDS): Promise<ChangeDocs> => {
  const docs: ChangeDocs = {}
  for (const kind of only) {
    const text = await safe(() => io.read(`${dir}/${kind}.md`))
    const meta = text === null ? null : parseFrontMatter(text)
    if (meta) docs[kind] = meta
  }
  return docs
}

const summaryOf = (id: string, intent: Meta | null, next: string | null): ChangeSummary => ({
  id,
  next,
  outcome: intent?.outcome || null,
  closedAt: intent?.closed_at || null,
})

const SAFE_ID = /^[A-Za-z0-9._-]+$/

/**
 * The AI-SDLC section's data from the repo's files, or null when the project has none. `cache` holds
 * closed changes (an outcome is set): they are not read again. Open changes and the active one are.
 */
export const readSdlc = async (io: Io, root: string, cache: Record<string, ChangeSummary>): Promise<{ sdlc: Sdlc | null; cache: Record<string, ChangeSummary> }> => {
  const r = normalizeProject(root)
  const config = await readJson(io, `${r}/.sdlc/config.json`)
  const configured = typeof config?.artifactsDir === 'string' ? normalizeProject(config.artifactsDir) : ''
  const artifacts = configured && !configured.startsWith('/') && !/^[A-Za-z]:/.test(configured) && !configured.split('/').includes('..') ? configured : 'docs/sdlc'
  const base = `${r}/${artifacts}`

  const hasSdlc = await safe(() => io.list(`${r}/.sdlc`))
  const folders = await safe(() => io.list(base))
  if (!hasSdlc && !folders) return { sdlc: null, cache }

  const state = await readJson(io, `${r}/.sdlc/local/state.json`)
  const active = typeof state?.active === 'string' && SAFE_ID.test(state.active) && state.active !== '..' ? state.active : null

  const next: Record<string, ChangeSummary> = { ...cache }
  const changes: ChangeSummary[] = []
  const ids = (folders ?? []).filter(e => e.kind === 'dir' && SAFE_ID.test(e.name)).map(e => e.name).sort().reverse()
  for (const id of ids) {
    const cached = cache[id]
    if (cached) {
      changes.push(cached)
      continue
    }
    const text = await safe(() => io.read(`${base}/${id}/intent.md`))
    if (text === null) continue
    const intent = parseFrontMatter(text)
    if (!intent) {
      changes.push(summaryOf(id, null, null))
      continue
    }
    if (intent.outcome) {
      const closed = summaryOf(id, intent, `closed (${intent.outcome})`)
      next[id] = closed
      changes.push(closed)
      continue
    }
    const docs = { ...(await readDocs(io, `${base}/${id}`, KINDS.filter(k => k !== 'intent'))), intent }
    changes.push(summaryOf(id, intent, stageOf(docs).next))
  }

  const steps = active ? (state?.build as Record<string, { steps?: unknown }> | undefined)?.[active]?.steps : undefined
  const build = active && state ? buildRows(steps) : null
  let activeView: Pick<Sdlc, 'tier' | 'stages' | 'next'> = { tier: null, stages: null, next: null }
  if (active) {
    const docs = await readDocs(io, `${base}/${active}`)
    // The knowledge step is done once knowledges/log.md has a line for this change.
    const log = await safe(() => io.read(`${r}/knowledges/log.md`))
    if (docs.intent) activeView = stageOf(docs, log !== null && log.includes(active), build?.some(b => b.verdict !== 'pass') === true)
  }

  const implementersRaw = active ? (state?.implementers as Record<string, unknown> | undefined)?.[active] : undefined
  const implementers = Array.isArray(implementersRaw)
    ? implementersRaw
        .filter((x): x is { agent: string; model: string } => typeof x?.agent === 'string' && typeof x?.model === 'string')
        .map(x => ({ agent: clean(x.agent), model: clean(x.model) }))
    : null

  const backlogText = await safe(() => io.read(`${r}/docs/project/backlog.md`))
  const backlog = backlogText === null ? null : parseBacklogOrder(backlogText)

  return {
    sdlc: {
      activeId: active,
      ...activeView,
      isDirty: typeof state?.dirty === 'boolean' ? state.dirty : null,
      lastVerifyAt: typeof state?.lastVerify === 'string' ? state.lastVerify : null,
      build,
      implementers,
      maxRounds: MAX_ROUNDS,
      checklist: checklistOf(changes, backlog, active),
      isPendingKnown: backlog !== null,
    },
    cache: next,
  }
}
