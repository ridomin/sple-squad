import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { getConfigDir, getConfigFilePath } from './paths.ts'

describe('getConfigDir', () => {
  it('uses XDG_CONFIG_HOME on linux when set', () => {
    const dir = getConfigDir({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/custom/xdg' },
      homedir: '/home/rido'
    })
    assert.equal(dir, '/custom/xdg/sple')
  })

  it('falls back to ~/.config/sple on linux without XDG_CONFIG_HOME', () => {
    const dir = getConfigDir({ platform: 'linux', env: {}, homedir: '/home/rido' })
    assert.equal(dir, '/home/rido/.config/sple')
  })

  it('treats a blank XDG_CONFIG_HOME as unset', () => {
    const dir = getConfigDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '   ' }, homedir: '/home/rido' })
    assert.equal(dir, '/home/rido/.config/sple')
  })

  it('uses Library/Application Support on macOS (ignores XDG_CONFIG_HOME)', () => {
    const dir = getConfigDir({
      platform: 'darwin',
      env: { XDG_CONFIG_HOME: '/custom/xdg' },
      homedir: '/Users/rido'
    })
    assert.equal(dir, '/Users/rido/Library/Application Support/sple')
  })

  it('uses %APPDATA%\\sple on Windows when APPDATA is set', () => {
    const dir = getConfigDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\rido\\AppData\\Roaming' },
      homedir: 'C:\\Users\\rido'
    })
    // node:path.join always uses the host's separator; on a POSIX host that
    // means the Windows-style APPDATA prefix is kept verbatim and only the
    // final segment is joined with '/'. On an actual Windows host this
    // produces the fully Windows-style path.
    assert.equal(dir, join('C:\\Users\\rido\\AppData\\Roaming', 'sple'))
  })

  it('falls back to ~/.sple on Windows when APPDATA is unset', () => {
    const dir = getConfigDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\rido' })
    assert.equal(dir, join('C:\\Users\\rido', '.sple'))
  })

  it('falls back to ~/.sple on any other platform', () => {
    const dir = getConfigDir({ platform: 'freebsd', env: {}, homedir: '/home/rido' })
    assert.equal(dir, '/home/rido/.sple')
  })
})

describe('getConfigFilePath', () => {
  it('joins the config dir and filename', () => {
    const path = getConfigFilePath('tokens.json', {
      platform: 'linux',
      env: {},
      homedir: '/home/rido'
    })
    assert.equal(path, '/home/rido/.config/sple/tokens.json')
  })
})
