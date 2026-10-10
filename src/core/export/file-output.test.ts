import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { CanonicalPlaylistFile } from './format.ts'
import {
  ExportTargetError,
  getExportFilename,
  prepareExportTargets,
  writeAtomicFile
} from './file-output.ts'

const testRoot = join(process.cwd(), `.sple-export-test-${process.pid}-${randomUUID()}`)

function fixture (overrides: Partial<CanonicalPlaylistFile> = {}): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'playlist' },
    playlist: { id: 'abc-123', name: 'Café / Mix', trackCount: 0 },
    tracks: [],
    unsupportedItems: [],
    ...overrides
  }
}

before(async () => {
  await mkdir(testRoot, { recursive: true })
})

after(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

test('creates ADR filenames with a normalized slug and path-safe ID', () => {
  assert.equal(getExportFilename(fixture(), 'json'), 'cafe-mix-abc-123.json')
  assert.equal(
    getExportFilename(fixture({
      playlist: { id: '../outside', name: 'A'.repeat(61), trackCount: 0 }
    }), 'csv'),
    `${'a'.repeat(60)}-..%2Foutside.csv`
  )
  assert.equal(getExportFilename(fixture({
    source: { provider: 'spotify', kind: 'liked' },
    playlist: { name: 'Liked Songs', trackCount: 0 }
  }), 'json'), 'liked-songs.json')
})

test('uses playlist fallback slug and requires an ID for playlist filenames', () => {
  assert.equal(getExportFilename(fixture({
    playlist: { id: 'x', name: '💿', trackCount: 0 }
  }), 'json'), 'playlist-x.json')
  assert.throws(() => getExportFilename(fixture({
    playlist: { name: 'No ID', trackCount: 0 }
  }), 'json'), ExportTargetError)
})

test('prepares per-source targets inside a created output directory', async () => {
  const destination = join(testRoot, 'new-directory')
  const files = [fixture(), fixture({
    playlist: { id: 'second', name: 'Second', trackCount: 0 }
  })]
  const targets = await prepareExportTargets(destination, files, 'json')
  assert.deepEqual(targets, [
    join(destination, 'cafe-mix-abc-123.json'),
    join(destination, 'second-second.json')
  ])
})

test('rejects colliding filenames before creating the output directory', async () => {
  const destination = join(testRoot, 'duplicate-directory')
  const file = fixture()
  await assert.rejects(
    prepareExportTargets(destination, [file, file], 'json'),
    ExportTargetError
  )
  await assert.rejects(readdir(destination))
})

test('file destinations require an existing parent directory', async () => {
  const destination = join(testRoot, 'missing-parent', 'export.json')
  await assert.rejects(
    prepareExportTargets(destination, [fixture()], 'json'),
    ExportTargetError
  )
  await assert.rejects(readdir(dirname(destination)))
  await assert.rejects(writeAtomicFile(destination, 'content'), ExportTargetError)
})

test('rejects a directory destination that is an existing file', async () => {
  const destination = join(testRoot, 'not-a-directory')
  await writeFile(destination, 'existing')
  await assert.rejects(
    prepareExportTargets(`${destination}/`, [fixture(), fixture()], 'json'),
    /not a directory/v
  )
  await rm(destination)
})

test('preflights all existing targets and allows explicit force', async () => {
  const destination = join(testRoot, 'existing-directory')
  await mkdir(destination)
  const file = fixture()
  const secondFile = fixture({
    playlist: { id: 'second', name: 'Second', trackCount: 0 }
  })
  const target = join(destination, getExportFilename(file, 'json'))
  const secondTarget = join(destination, getExportFilename(secondFile, 'json'))
  await writeFile(target, 'existing')
  await writeFile(secondTarget, 'existing too')
  const targets = [target, secondTarget]
  await assert.rejects(
    prepareExportTargets(`${destination}/`, [file, secondFile], 'json'),
    (error: unknown) => {
      assert.ok(error instanceof ExportTargetError)
      assert.ok(error.message.includes(target))
      assert.ok(error.message.includes(secondTarget))
      return true
    }
  )
  assert.deepEqual(await prepareExportTargets(`${destination}/`, [file, secondFile], 'json', true), targets)
})

test('atomic writes refuse overwrite unless forced', async () => {
  const target = join(testRoot, 'atomic.json')
  await writeAtomicFile(target, 'first')
  await assert.rejects(writeAtomicFile(target, 'second'), /already exists/v)
  assert.equal(await readFile(target, 'utf8'), 'first')
  await writeAtomicFile(target, 'second', { force: true })
  assert.equal(await readFile(target, 'utf8'), 'second')
})

test('concurrent non-forced writes install exactly one complete file', async () => {
  const target = join(testRoot, 'concurrent.json')
  const results = await Promise.allSettled([
    writeAtomicFile(target, 'first'),
    writeAtomicFile(target, 'second')
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.ok(['first', 'second'].includes(await readFile(target, 'utf8')))
})

test('cleans the temporary sibling after a failed atomic replacement', async () => {
  const targetDirectory = join(testRoot, 'target-directory')
  await mkdir(targetDirectory)
  await assert.rejects(writeAtomicFile(targetDirectory, 'content', { force: true }))
  assert.deepEqual(await readdir(testRoot), [
    'atomic.json',
    'concurrent.json',
    'existing-directory',
    'new-directory',
    'target-directory'
  ])
})
