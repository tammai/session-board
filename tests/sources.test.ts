import { expect, test } from 'claude-code/testing'

import { readSdlc, trackProjectCost } from '../hooks/sources'
import type { Io } from '../hooks/sources'
import { REVIEW, band } from './fixtures/sdlc'

type Fake = Io & { reads: string[] }

/** An in-memory project: files by absolute path; directories are implied by the paths. */
const fakeIo = (files: Record<string, string>, extra: Partial<Io> = {}, store = new Map<string, unknown>()): Fake => {
  const reads: string[] = []
  const io: Fake = {
    reads,
    async read(path) {
      reads.push(path)
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    async list(path) {
      const seen = new Map<string, 'file' | 'dir'>()
      for (const p of Object.keys(files)) {
        if (!p.startsWith(`${path}/`)) continue
        const [first, ...rest] = p.slice(path.length + 1).split('/')
        if (first) seen.set(first, rest.length > 0 ? 'dir' : 'file')
      }
      if (seen.size === 0) throw new Error(`ENOENT ${path}`)
      return [...seen].map(([name, kind]) => ({ name, kind }))
    },
    async homeDir() {
      return undefined
    },
    async configDir() {
      return undefined
    },
    async storeGet(key) {
      return store.get(key)
    },
    async storeSet(key, value) {
      store.set(key, value)
    },
    ...extra,
  }
  return io
}

test('the AI-SDLC line is read from the band file ai-sdlc wrote, and from nothing else; no file, no line', async () => {
  const files: Record<string, string> = {
    '/p/.sdlc/local/band.json': band(REVIEW),
    '/p/.sdlc/local/state.json': JSON.stringify({ active: 'another' }),
    '/p/docs/sdlc/another/intent.md': '---\nartifact: intent\n---\n',
  }
  const reader = fakeIo(files)
  expect(await readSdlc(reader, '/p')).toEqual(REVIEW)
  expect(reader.reads).toEqual(['/p/.sdlc/local/band.json']) // the state and the change's documents are not read
  expect(await readSdlc(fakeIo({}), '/empty')).toBe(null)
  expect(await readSdlc(fakeIo({ '/p/.sdlc/config.json': '{}' }), '/p')).toBe(null) // an .sdlc folder with no band file
})

test('anything unreadable is null, never a throw: failing io, garbage json, a file of another shape', async () => {
  const dead = fakeIo({}, {
    read: async () => {
      throw new Error('boom')
    },
    list: async () => {
      throw new Error('boom')
    },
  })
  expect(await trackProjectCost(dead, '/p', 'live', null)).toBe(null)
  expect(await readSdlc(dead, '/p')).toBe(null)
  for (const text of ['garbage', '[]', '"x"', 'null', '{"version":1']) expect(await readSdlc(fakeIo({ '/p/.sdlc/local/band.json': text }), '/p')).toBe(null)
})

test("the project total is the board's own ledger: the statusline's records are imported once, never read again", async () => {
  const dir = 'C:/Users/me/.claude/statusline-cost/6a1a27ab17469111'
  const files: Record<string, string> = {
    [`${dir}/.seeded`]: 'seeded',
    [`${dir}/s1`]: '{"base": 1.0, "last": 2.0}',
    [`${dir}/s2`]: '{"base": 0.5, "last": 0.25}',
    [`${dir}/s3`]: 'garbage',
  }
  const store = new Map<string, unknown>() // what the host keeps across sessions
  const io = (f: Record<string, string>) => fakeIo(f, { homeDir: async () => 'C:\\Users\\me' }, store)
  const project = 'C:\\Users\\me\\projects\\demo\\'

  // First run: the old records (3.75) are copied, and this session's 1.0 is added.
  const first = io(files)
  expect(await trackProjectCost(first, project, 'live', 1)).toBe(4.75)
  expect(first.reads.some(p => p.endsWith('/s1'))).toBe(true)

  // The statusline's folder is gone, and the session has cost more: the board carries on by itself.
  const second = io({})
  expect(await trackProjectCost(second, project, 'live', 2)).toBe(5.75)
  expect(second.reads).toEqual([])
  // A counter that restarted (a resumed session) keeps what the session had cost before.
  expect(await trackProjectCost(second, project, 'live', 0.5)).toBe(6.25)
  // With nothing known about this session the total is what the ledger holds.
  expect(await trackProjectCost(second, project, 'live', null)).toBe(6.25)
  // Another project has its own ledger.
  expect(await trackProjectCost(second, 'C:/other/project', 'live', 1)).toBe(1)
})
