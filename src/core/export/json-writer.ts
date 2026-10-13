import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { AnySchema, ValidateFunction } from 'ajv'
import type { CanonicalPlaylistFile } from './format.ts'
import { assertPlaylistFile, ExportFormatError } from './invariants.ts'

const JSON_INDENT = 2
const EMPTY_LENGTH = 0
const schemaPath = fileURLToPath(new URL('../../../schemas/canonical-playlist.v1.schema.json', import.meta.url))
const schemaValue: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'))
if (!isAnySchema(schemaValue)) throw new Error(`Invalid canonical playlist schema at ${schemaPath}`)
const schema = schemaValue
const validate: ValidateFunction = new Ajv2020({ strict: true }).compile(schema)

function isAnySchema (value: unknown): value is AnySchema {
  return typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
}

function assertCanonicalJSONSchema (serialized: string): void {
  const output: unknown = JSON.parse(serialized)
  if (!validate(output)) {
    const problems = (validate.errors ?? []).map((error) => {
      const path = error.instancePath.length > EMPTY_LENGTH ? error.instancePath : '/'
      return `${path} ${error.message ?? 'is invalid'}`
    })
    throw new ExportFormatError(problems)
  }
}

/**
 * Serialize a canonical playlist file in the stable v1 field order defined by
 * ADR-0008. Copying known fields prevents runtime-only properties from leaking
 * into the closed JSON Schema.
 */
export function serializePlaylistJSON (file: CanonicalPlaylistFile): string {
  assertPlaylistFile(file)

  const canonical = {
    schemaVersion: file.schemaVersion,
    exportedAt: file.exportedAt,
    generator: {
      name: file.generator.name,
      version: file.generator.version
    },
    source: {
      provider: file.source.provider,
      kind: file.source.kind,
      ...(file.source.userId === undefined ? {} : { userId: file.source.userId })
    },
    playlist: {
      ...(file.playlist.ref === undefined ? {} : { ref: file.playlist.ref }),
      ...(file.playlist.id === undefined ? {} : { id: file.playlist.id }),
      name: file.playlist.name,
      ...(file.playlist.description === undefined ? {} : { description: file.playlist.description }),
      ...(file.playlist.owner === undefined
        ? {}
        : {
            owner: {
              id: file.playlist.owner.id,
              ...(file.playlist.owner.displayName === undefined
                ? {}
                : { displayName: file.playlist.owner.displayName })
            }
          }),
      ...(file.playlist.public === undefined ? {} : { public: file.playlist.public }),
      ...(file.playlist.collaborative === undefined ? {} : { collaborative: file.playlist.collaborative }),
      ...(file.playlist.url === undefined ? {} : { url: file.playlist.url }),
      trackCount: file.playlist.trackCount
    },
    tracks: [...file.tracks]
      .sort((left, right) => left.position - right.position)
      .map((track) => ({
        title: track.title,
        artists: [...track.artists],
        ...(track.album === undefined ? {} : { album: track.album }),
        ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
        ...(track.isrc === undefined ? {} : { isrc: track.isrc }),
        refs: Object.fromEntries(
          Object.keys(track.refs)
            .sort()
            .map((provider) => [provider, track.refs[provider]])
        ),
        ...(track.addedAt === undefined ? {} : { addedAt: track.addedAt }),
        position: track.position
      })),
    unsupportedItems: [...file.unsupportedItems]
      .sort((left, right) => left.position - right.position)
      .map((item) => ({
        position: item.position,
        kind: item.kind,
        ...(item.name === undefined ? {} : { name: item.name }),
        ...(item.ref === undefined ? {} : { ref: item.ref })
      }))
  }

  const serialized = JSON.stringify(canonical, null, JSON_INDENT)
  assertCanonicalJSONSchema(serialized)
  return `${serialized}\n`
}
