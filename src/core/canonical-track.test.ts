import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanonicalTrack } from './canonical-track.ts'

test('CanonicalTrack accepts an isrc-absent track (unresolved)', () => {
  const track: CanonicalTrack = {
    title: 'Track A',
    artists: ['Artist A'],
    refs: { spotify: 'spotify:track:abc123' }
  }
  assert.equal('isrc' in track, false)
})

test('CanonicalTrack accepts isrc: null (provider confirmed none)', () => {
  const track: CanonicalTrack = {
    title: 'Track B',
    artists: ['Artist B'],
    isrc: null,
    refs: { spotify: 'spotify:track:def456' }
  }
  assert.equal(track.isrc, null)
})

test('CanonicalTrack accepts a resolved isrc string', () => {
  const track: CanonicalTrack = {
    title: 'Track C',
    artists: ['Artist C'],
    isrc: 'USRC17607839',
    refs: { spotify: 'spotify:track:ghi789' }
  }
  assert.equal(track.isrc, 'USRC17607839')
})

test('CanonicalTrack supports multiple provider refs and optional fields', () => {
  const track: CanonicalTrack = {
    title: 'Track D',
    artists: ['Artist D', 'Featured Artist'],
    album: 'Album D',
    durationMs: 210000,
    addedAt: '2026-09-01T12:34:56Z',
    refs: {
      spotify: 'spotify:track:jkl012',
      'youtube-music': 'dQw4w9WgXcQ'
    }
  }
  assert.equal(track.artists.length, 2)
  assert.equal(Object.keys(track.refs).length, 2)
})
