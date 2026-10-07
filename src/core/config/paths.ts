// OS-aware path resolution for sple's config directory (ADR 0004 §1 and
// Amendment 1). Pure path computation only — no I/O here.
import { join } from 'node:path'

export interface PlatformEnv {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homedir: string
}

export function currentPlatformEnv (): PlatformEnv {
  return {
    platform: process.platform,
    env: process.env,
    homedir: homedirFallback()
  }
}

function homedirFallback (): string {
  // Avoid importing node:os just for homedir() at module scope so tests can
  // stub it easily; still delegate to the real implementation here.
  return (
    process.env.HOME ??
    process.env.USERPROFILE ??
    '/'
  )
}

// Returns the platform-specific sple config directory (ADR 0004 §1):
// - Linux: `${XDG_CONFIG_HOME}/sple` or `~/.config/sple`
// - macOS: `~/Library/Application Support/sple`
// - Windows: `%APPDATA%\sple`, or `~/.sple` if APPDATA is unset
// - Fallback (any other platform): `~/.sple`
const EMPTY_LENGTH = 0

export function getConfigDir (context: PlatformEnv = currentPlatformEnv()): string {
  const { platform, env, homedir } = context

  if (platform === 'win32') {
    const { APPDATA: appData } = env
    if (appData !== undefined && appData.trim().length > EMPTY_LENGTH) {
      return join(appData, 'sple')
    }
    return join(homedir, '.sple')
  }

  if (platform === 'darwin') {
    return join(homedir, 'Library', 'Application Support', 'sple')
  }

  if (platform === 'linux') {
    const { XDG_CONFIG_HOME: xdgConfigHome } = env
    if (xdgConfigHome !== undefined && xdgConfigHome.trim().length > EMPTY_LENGTH) {
      return join(xdgConfigHome, 'sple')
    }
    return join(homedir, '.config', 'sple')
  }

  // Fallback for any other platform.
  return join(homedir, '.sple')
}

export function getConfigFilePath (
  filename: string,
  context: PlatformEnv = currentPlatformEnv()
): string {
  return join(getConfigDir(context), filename)
}
