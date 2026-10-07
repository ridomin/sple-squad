import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getHelpText, getVersion, run } from './index.ts'

describe('cli entrypoint smoke test', () => {
  it('reports a non-empty version string', () => {
    assert.equal(typeof getVersion(), 'string')
    assert.ok(getVersion().length > 0)
  })

  it('prints help text including usage', () => {
    assert.ok(getHelpText().includes('Usage: sple'))
  })

  it('run() returns 0 for --version', () => {
    assert.equal(run(['--version']), 0)
  })

  it('run() returns 0 for --help', () => {
    assert.equal(run(['--help']), 0)
  })

  it('run() returns 1 for an unknown option', () => {
    assert.equal(run(['--nope']), 1)
  })
})
