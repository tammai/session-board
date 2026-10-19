import { expect, test } from 'claude-code/testing'

import { readGit, readSdlc, trackProjectCost } from '../hooks/sources'
import type { Io } from '../hooks/sources'
import { BACKLOG, TIER_M, TIER_S } from './fixtures/sdlc'

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
    async run() {
      throw new Error('no process')
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

const change = (id: string, docs: Record<string, string>, files: Record<string, string> = {}) => {
  for (const [kind, text] of Object.entries(docs)) files[`/p/docs/sdlc/${id}/${kind}.md`] = text
  return files
}

const SHIPPED = '2026-10-14-ship-notifies-the-human-when-a-change-is-closed'
const OPEN = '2026-10-19-open-change'

const openDocs = () => {
  const { review: _review, ...rest } = TIER_M
  return { ...rest, intent: (TIER_M.intent as string).replace('outcome: shipped\n', '') }
}

test('the sdlc section is read from the repo files; a project without them gives no section', async () => {
  const files: Record<string, string> = {
    '/p/.sdlc/config.json': '{"artifactsDir":"docs/sdlc"}',
    '/p/.sdlc/local/state.json': JSON.stringify({
      active: OPEN,
      dirty: true,
      lastVerify: '2026-10-19T13:58:20Z',
      implementers: { [OPEN]: [{ agent: 'ai-sdlc:implementer', model: 'sonnet' }] },
      build: { [OPEN]: { steps: { spec: { rounds: 2, model: 'sonnet', verdict: 'fail' } } } },
    }),
    '/p/docs/project/backlog.md': BACKLOG,
  }
  change(SHIPPED, TIER_S, files)
  change(OPEN, openDocs(), files)
  const { sdlc } = await readSdlc(fakeIo(files), '/p', {})
  expect(sdlc?.activeId).toBe(OPEN)
  expect(sdlc?.next).toBe('review')
  expect(sdlc?.stages?.review).toBe('current')
  expect(sdlc?.isDirty).toBe(true)
  expect(sdlc?.lastVerifyAt).toBe('2026-10-19T13:58:20Z')
  expect(sdlc?.build).toEqual([{ step: 'spec', rounds: 2, model: 'sonnet', verdict: 'fail' }])
  expect(sdlc?.implementers).toEqual([{ agent: 'ai-sdlc:implementer', model: 'sonnet' }])
  // working first, the backlog next, finished last
  expect(sdlc?.checklist.map(i => `${i.state}:${i.id}`)).toEqual([`working:${OPEN}`, 'pending:D1', 'pending:L2', `done:${SHIPPED}`])
  expect(sdlc?.isPendingKnown).toBe(true)

  expect((await readSdlc(fakeIo({}), '/empty', {})).sdlc).toBe(null)
  expect(sdlc?.stages?.knowledge).toBe('todo')

  // the knowledge step is done once knowledges/log.md has a line for the active change
  files['/p/knowledges/log.md'] = `- ${OPEN}: concepts written
`
  expect((await readSdlc(fakeIo(files), '/p', {})).sdlc?.stages?.knowledge).toBe('done')
})

test('anything unreadable is null, never a throw: failing io, garbage json, a change with no front matter', async () => {
  const dead = fakeIo({}, {
    read: async () => {
      throw new Error('boom')
    },
    list: async () => {
      throw new Error('boom')
    },
  })
  expect(await readGit(dead, '/p')).toEqual({ branch: null, dirty: null, added: null, removed: null })
  expect(await trackProjectCost(dead, '/p', 'live', null)).toBe(null)
  expect((await readSdlc(dead, '/p', {})).sdlc).toBe(null)

  const files: Record<string, string> = {
    '/p/.sdlc/config.json': '{not json',
    '/p/.sdlc/local/state.json': 'garbage',
  }
  change(SHIPPED, TIER_S, files)
  files['/p/docs/sdlc/2026-10-20-broken/intent.md'] = 'no front matter here'
  files['/p/docs/sdlc/adr/0001.md'] = '# an ADR, not a change'
  const { sdlc } = await readSdlc(fakeIo(files), '/p', {})
  expect(sdlc?.activeId).toBe(null)
  expect(sdlc?.build).toBe(null)
  expect(sdlc?.isPendingKnown).toBe(false)
  // a change whose front matter cannot be read is listed with what is unknown left null
  expect(sdlc?.checklist).toEqual([
    { id: '2026-10-20-broken', state: 'working', note: null },
    { id: SHIPPED, state: 'done', note: null },
  ])
})

test('a project with hundreds of changes re-reads only what is open; the list stays short', async () => {
  const files: Record<string, string> = { '/p/.sdlc/config.json': '{}' }
  for (let i = 0; i < 300; i += 1) change(`2026-01-${String(i).padStart(3, '0')}-c`, TIER_S, files)
  const first = await readSdlc(fakeIo(files), '/p', {})
  expect(first.sdlc?.checklist).toHaveLength(10)
  const again = fakeIo(files)
  const second = await readSdlc(again, '/p', first.cache)
  expect(second.sdlc?.checklist).toHaveLength(10)
  expect(again.reads.filter(p => p.endsWith('intent.md'))).toEqual([])
})

test('git gives the branch, the changed files and the lines added and removed', async () => {
  const asked: (readonly string[])[] = []
  // status answers `status`, numstat answers `diff`; null makes that call fail.
  const git = (status: string | null, numstat: string | null) => async (argv: readonly string[]) => {
    asked.push(argv)
    const out = argv.includes('diff') ? numstat : status
    return out === null ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: out }
  }
  const NUMSTAT = '10\t2\ta.ts\n2\t1\tb.ts\n-\t-\timg.png\n' // a binary file has no line counts
  expect(await readGit(fakeIo({}, { run: git('## main...origin/main\n M a.ts\n?? b.ts\n', NUMSTAT) }), '/p')).toEqual({ branch: 'main', dirty: 2, added: 12, removed: 3 })
  // A repo's own config can name a program for git to run (core.fsmonitor, diff drivers): the board switches them off.
  expect(asked.every(a => a.includes('core.fsmonitor=false'))).toBe(true)
  expect(asked.find(a => a.includes('diff'))).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv']))
  expect(await readGit(fakeIo({}, { run: git('## HEAD (no branch)\n', '') }), '/p')).toEqual({ branch: 'detached', dirty: 0, added: 0, removed: 0 })
  // No commits yet, or diff refused: the branch still shows and the counts are unknown.
  expect(await readGit(fakeIo({}, { run: git('## main\n', null) }), '/p')).toEqual({ branch: 'main', dirty: 0, added: null, removed: null })
  expect(await readGit(fakeIo({}, { run: git(null, null) }), '/p')).toEqual({ branch: null, dirty: null, added: null, removed: null })

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
