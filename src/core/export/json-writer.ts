import type { CanonicalPlaylistFile } from './format.ts'
import { assertPlaylistFile } from './invariants.ts'

const JSON_INDENT = 2

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

  return `${JSON.stringify(canonical, null, JSON_INDENT)}\n`
}
