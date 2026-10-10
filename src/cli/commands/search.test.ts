import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import type { SearchItem } from '../../core/provider/provider.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { runCli } from '../framework.ts'
import type { CliIO } from '../framework.ts'
import { createSearchCommand } from './search.ts'

class CaptureWritable extends Writable {
  readonly chunks: string[] = []

  override _write (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString())
    callback()
  }

  get text (): string {
    return this.chunks.join('')
  }
}

function createIO (stdoutIsTTY = false): CliIO & {
  stdout: CaptureWritable
  stderr: CaptureWritable
} {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

function fixtureTracks (count: number): Array<{
  id: string
  title: string
  artists: string[]
  album: string
  durationMs: number
}> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}`,
    title: `Song ${index + 1}`,
    artists: ['Artist'],
    album: 'Album',
    durationMs: 123000
  }))
}

function parseJson (text: string): unknown {
  const parsed: unknown = JSON.parse(text)
  return parsed
}

function asRecord (value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a JSON object')
  }
  return value
}

function getItems (value: unknown): unknown[] {
  const { items } = asRecord(value)
  if (!Array.isArray(items)) throw new TypeError('Expected an items array')
  return items
}

async function invoke (
  args: string[],
  provider = createFakeProvider(),
  stdoutIsTTY = false
): Promise<{ code: number, io: ReturnType<typeof createIO> }> {
  const io = createIO(stdoutIsTTY)
  const code = await runCli(args, {
    commands: [createSearchCommand(() => provider)],
    io,
    processEnv: { SPLE_DEFAULT_PROVIDER: 'fake' },
    envFilePath: '.sple-search-test-no-env'
  })
  return { code, io }
}

describe('sple search', () => {
  it('joins query words and returns stable JSON items with IDs and provider refs', async () => {
    const provider = createFakeProvider({
      fixtures: { catalog: fixtureTracks(1) }
    })
    const { code, io } = await invoke(['search', 'Song', '1', '--json'], provider)

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(parseJson(io.stdout.text), {
      items: [{
        type: 'track',
        id: '1',
        ref: 'fake:track:1',
        name: 'Song 1',
        track: {
          title: 'Song 1',
          artists: ['Artist'],
          refs: { fake: 'fake:track:1' },
          album: 'Album',
          durationMs: 123000
        }
      }],
      total: 1
    })
    assert.equal(io.stderr.text, '')
  })

  it('preserves provider IDs, URIs, and URLs in JSON results', async () => {
    const provider = createFakeProvider()
    const artist: SearchItem = {
      type: 'artist',
      id: 'artist-id',
      ref: 'fake:artist:artist-id',
      url: 'https://example.test/artists/artist-id',
      name: 'Artist'
    }
    provider.search = async () => await Promise.resolve({ items: [artist], total: 1 })

    const { code, io } = await invoke([
      'search', 'Artist', '--type', 'artist', '--json'
    ], provider)

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(parseJson(io.stdout.text), {
      items: [artist],
      total: 1
    })
  })

  it('splits a requested limit into pages no larger than the capability and exposes next offset', async () => {
    const provider = createFakeProvider({
      fixtures: { catalog: fixtureTracks(6) },
      capabilities: { maxSearchPageSize: 2 }
    })
    const requests: Array<{ limit: number, offset?: number }> = []
    const { search } = provider
    provider.search = async (query, page) => {
      requests.push(page)
      return await search(query, page)
    }

    const { code, io } = await invoke(['search', 'Song', '--limit', '5', '--json'], provider)
    const output = asRecord(parseJson(io.stdout.text))

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(requests, [
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 1, offset: 4 }
    ])
    assert.equal(getItems(output).length, 5)
    assert.equal(output.total, 6)
    assert.deepEqual(output.next, { offset: 5 })
  })

  it('counts --all safety caps in results while still splitting provider pages', async () => {
    const provider = createFakeProvider({
      fixtures: { catalog: fixtureTracks(6) },
      capabilities: { maxSearchPageSize: 2 }
    })
    const requests: number[] = []
    const { search } = provider
    provider.search = async (query, page) => {
      requests.push(page.limit)
      return await search(query, page)
    }

    const { code, io } = await invoke([
      'search', 'Song', '--all', '--max-results', '3', '--json'
    ], provider)
    const output = asRecord(parseJson(io.stdout.text))

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(requests, [2, 1])
    assert.equal(getItems(output).length, 3)
    assert.deepEqual(output.next, { offset: 3 })
  })

  it('rejects nonzero offsets on cursor-forward providers before searching', async () => {
    const provider = createFakeProvider({
      capabilities: { paginationModel: 'cursor-forward' }
    })
    let called = false
    provider.search = async () => {
      called = true
      return await Promise.resolve({ items: [] })
    }

    const { code, io } = await invoke(['search', 'Song', '--offset', '1'], provider)

    assert.equal(code, EXIT_CODES.usage)
    assert.match(io.stderr.text, /--offset is not supported/v)
    assert.equal(called, false)
  })

  it('accepts zero offset on cursor-forward providers without sending an offset', async () => {
    const provider = createFakeProvider({
      capabilities: { paginationModel: 'cursor-forward' }
    })
    const requests: Array<{ limit: number, offset?: number }> = []
    provider.search = async (_query, page) => {
      requests.push(page)
      return await Promise.resolve({ items: [] })
    }

    const { code } = await invoke([
      'search', 'Song', '--offset', '0', '--json'
    ], provider)

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(requests, [{ limit: 10 }])
  })

  it('uses a cursor to continue a capped search on cursor-forward providers', async () => {
    const provider = createFakeProvider({
      capabilities: { paginationModel: 'cursor-forward', maxSearchPageSize: 1 }
    })
    const first: SearchItem = {
      type: 'artist',
      id: 'a1',
      ref: 'fake:artist:a1',
      name: 'Artist One'
    }
    const second: SearchItem = {
      type: 'artist',
      id: 'a2',
      ref: 'fake:artist:a2',
      name: 'Artist Two'
    }
    const requests: Array<{ limit: number, cursor?: string }> = []
    provider.search = async (_query, page) => {
      requests.push(page)
      return await Promise.resolve(page.cursor === undefined
        ? { items: [first], next: { cursor: 'next-page' }, total: 3 }
        : { items: [second], next: { cursor: 'last-page' }, total: 3 })
    }

    const { code, io } = await invoke([
      'search', 'Artist', '--type', 'artist', '--limit', '2', '--json'
    ], provider)
    const output = asRecord(parseJson(io.stdout.text))

    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(requests, [{ limit: 1 }, { limit: 1, cursor: 'next-page' }])
    assert.deepEqual(getItems(output), [first, second])
    assert.deepEqual(output.next, { cursor: 'last-page' })
  })

  it('formats quiet IDs and human-readable rows according to the selected output mode', async () => {
    const provider = createFakeProvider({
      fixtures: { catalog: fixtureTracks(1) }
    })
    const quiet = await invoke(['search', 'Song', '--quiet'], provider)
    const human = await invoke(['search', 'Song'], provider, true)

    assert.equal(quiet.code, EXIT_CODES.success)
    assert.equal(quiet.io.stdout.text, '1\n')
    const humanText = human.io.stdout.text
      .replaceAll('\u001b[1m', '')
      .replaceAll('\u001b[0m', '')
    assert.match(humanText, /title\s+artists\s+album\s+duration\s+id\n/v)
    assert.match(humanText, /Song 1\s+Artist\s+Album\s+2:03\s+1\n/v)
  })

  it('reports empty results on stderr without writing a result payload', async () => {
    const { code, io } = await invoke(['search', 'missing', '--json'])

    assert.equal(code, EXIT_CODES.success)
    assert.equal(io.stdout.text, '')
    assert.equal(io.stderr.text, 'sple: No results for "missing" in Fake Provider\n')
  })

  it('rejects missing queries, invalid types, incompatible flags, and unsafe limits', async () => {
    const cases = [
      { args: ['search'], message: /query must not be empty/v },
      { args: ['search', 'Song', '--type', 'genre'], message: /--type must be one of/v },
      { args: ['search', 'Song', '--all', '--limit', '2'], message: /cannot be combined/v },
      { args: ['search', 'Song', '--max-results', '2'], message: /requires --all/v },
      { args: ['search', 'Song', '--offset', '999', '--limit', '2'], message: /must not exceed 1000/v },
      { args: ['search', 'Song', '--all', '--max-results', '1001'], message: /must not exceed 1000/v }
    ]

    const results = await Promise.all(cases.map(async testCase => ({
      testCase,
      result: await invoke(testCase.args)
    })))
    for (const { testCase, result } of results) {
      assert.equal(result.code, EXIT_CODES.usage, testCase.args.join(' '))
      assert.match(result.io.stderr.text, testCase.message, testCase.args.join(' '))
    }
  })
})
