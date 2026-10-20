// Pure maths behind the Status row. The thresholds, the reset format and the project-cost ledger follow
// the author's statusline.sh, so the board and the status line show the same numbers.

export const NA = 'N/A'

export type Tone = 'green' | 'orange' | 'red'

const clampPct = (pct: number) => Math.min(100, Math.max(0, Math.round(pct)))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Calm to 50, orange past it, red from 80. */
export const toneOf = (pct: number): Tone => (pct >= 80 ? 'red' : pct > 50 ? 'orange' : 'green')

export const pctText = (pct: number | null | undefined) => (isNum(pct) ? `${clampPct(pct)}%` : NA)

/** Time left until a reset: `43m`, `2h14m`, `4d3h`; `now` once it has passed; N/A when unknown. */
export const untilReset = (resetsAtMs: number | null | undefined, nowMs: number): string => {
  if (!isNum(resetsAtMs) || !isNum(nowMs)) return NA
  const secs = Math.floor((resetsAtMs - nowMs) / 1000)
  if (secs <= 0) return 'now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export const money = (n: number | null | undefined) => (isNum(n) && n >= 0 ? `$${n.toFixed(2)}` : NA)

/** The project path as the ledger hashes it: forward slashes, no trailing slash. */
export const normalizeProject = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** The project's key: the first 16 hex characters of its path's SHA-1 (the statusline's ledger folder name too). */
export const projectKey = async (path: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(normalizeProject(path)))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

// ---------------------------------------------------------------- the project's spend

/**
 * The board's own record of a project's spend, counted like statusline.sh: one `[base, last]` per session.
 * `last` is the session's latest total; `base` is what it had cost before its counter restarted.
 * `imported`: the statusline's old records were copied in once, and are never read again.
 */
export type Ledger = { imported: boolean; sessions: Record<string, [number, number]> }

export const EMPTY_LEDGER: Ledger = { imported: false, sessions: {} }

const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])

/** A stored ledger of any shape, as a ledger: entries that are not a pair of numbers are dropped. */
export const normalizeLedger = (stored: unknown): Ledger => {
  if (typeof stored !== 'object' || stored === null) return EMPTY_LEDGER
  const { imported, sessions } = stored as { imported?: unknown; sessions?: unknown }
  const kept: Record<string, [number, number]> = {}
  if (typeof sessions === 'object' && sessions !== null) {
    for (const [id, pair] of Object.entries(sessions)) if (isPair(pair)) kept[id] = [pair[0], pair[1]]
  }
  return { imported: imported === true, sessions: kept }
}

/** The ledger after a session's total is seen: a total below the last one means the counter restarted. */
export const applySession = (ledger: Ledger, sessionId: string, total: number): Ledger => {
  if (!isNum(total) || total < 0) return ledger
  const [base, last] = ledger.sessions[sessionId] ?? [0, 0]
  const next: [number, number] = total < last ? [base + last, total] : [base, total]
  return { ...ledger, sessions: { ...ledger.sessions, [sessionId]: next } }
}

/** Every session's `base + last`; null when the ledger holds no session. */
export const projectTotal = (ledger: Ledger): number | null => {
  const all = Object.values(ledger.sessions)
  return all.length > 0 ? all.reduce((sum, [base, last]) => sum + base + last, 0) : null
}
