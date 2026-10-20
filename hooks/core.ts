// Pure data: defaults, config, palette and formatting. Nothing here touches `$`, so every
// behaviour is testable directly. Derived from claude-flightdeck (MIT, see NOTICE).
import type { Main, Sdlc, Status, Usage, View } from '../types'

export const SCHEMA_VERSION = 1

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: null, effort: null, isRunning: false }
export const DEFAULT_USAGE: Usage = { pct: null, costUsd: null, limits: [] }
export const DEFAULT_STATUS: Status = { projectCost: null }
export const DEFAULT_VIEW: View = { isShown: null }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The effort level the settings name, before any request has said: the model's own (`modelSettings[model].effortLevel`,
 * the `[1m]` suffix not part of its key) first, then the general `effortLevel`. Null when neither names a level.
 */
export const effortFromSettings = (settings: unknown, model: string | null): string | null => {
  if (!isObject(settings)) return null
  const level = (v: unknown) => (typeof v === 'string' && EFFORT_LEVELS.includes(v) ? v : null)
  const key = model ? model.replace(/\[.*\]$/, '') : null
  const own = key && isObject(settings.modelSettings) ? settings.modelSettings[key] : null
  return (isObject(own) ? level(own.effortLevel) : null) ?? level(settings.effortLevel)
}

/**
 * The ai-sdlc value as the drawing needs it. A value saved by another version may not be one (a list, text, an object without
 * the change's id): read it as none, and the line waits for the next read to replace it.
 */
export const normalizeSdlc = (stored: unknown): Sdlc | null => (isObject(stored) && 'activeId' in stored ? (stored as Sdlc) : null)

// ---------------------------------------------------------------- config

export type Palette = 'theme' | 'pastel'

export type Config = {
  palette: Palette
  openOnStart: boolean
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => ({
  palette: typeof o.palette === 'string' && o.palette === 'pastel' ? 'pastel' : 'theme',
  openOnStart: typeof o.openOnStart === 'boolean' ? o.openOnStart : true,
})

// ---------------------------------------------------------------- palette

export type Colors = Record<'border' | 'main' | 'dim' | 'text' | 'folder' | 'git' | 'bold' | 'red' | 'ink' | 'accent', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals. The orange, green and red are the author's statusline palette in both.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: {
    border: '#87ceeb', // sky blue
    main: 'claude',
    dim: 'inactive',
    text: 'text',
    folder: '#f07623',
    git: '#59c9a5',
    bold: '#e0def4',
    red: '#d81e5b',
    ink: '#262b44',
    accent: '#4a9fd8', // the desktop's blue: deeper than the sky blue, so it reads on a light background too
  },
  pastel: {
    border: '#87ceeb',
    main: '#7dd3fc',
    dim: '#6b7280',
    text: '#e5e7eb',
    folder: '#f07623',
    git: '#59c9a5',
    bold: '#e0def4',
    red: '#d81e5b',
    ink: '#262b44',
    accent: '#4a9fd8', // the desktop's blue: deeper than the sky blue, so it reads on a light background too
  },
}

// ---------------------------------------------------------------- formatting

/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`. Anything else is shown as given,
 * cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

/** Text from a file or a tool call with its control characters (ESC, BEL, C1) removed: it is drawn in a terminal. */
export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

/**
 * The width to give a box. On the terminal a count of columns is exact. On the desktop app a count of columns turns into fewer
 * pixels than the row has (the rest lands on one side, so the band sits off-centre), so a box there fills what it is given.
 */
export const widthOf = (surface: string, cells: number | string) => (surface === 'terminal' ? cells : '100%')

export const shorten = (s: string, n: number) => {
  const one = clean(s.replace(/\s+/g, ' ')).trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

/** A rate-limit reading as the board keeps it, its ISO reset time turned into ms since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }) => {
  const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, pct: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
}

/** The tools that can change files: a reason to read the repo again. */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
