// Permission checks for the `.env` config file (ADR 0004 §1 and Amendment
// 1). sple never writes `.env`. Parsing/loading is handled in `config.ts`;
// this module only validates the file's POSIX permissions.
import { constants as fsConstants } from 'node:fs'
import { stat } from 'node:fs/promises'

const OTHER_OR_GROUP_PERMISSIONS =
  fsConstants.S_IRWXG | fsConstants.S_IRWXO
const NO_PERMISSION_BITS_SET = 0

// Checks the `.env` file's POSIX permissions (Amendment 1): if any group or
// other bit is set, returns a warning message for the CLI to print to
// stderr; otherwise returns null. Always null on non-POSIX platforms (the
// mode bits aren't meaningful on Windows).
export async function checkEnvFilePermissions (
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (platform === 'win32') {
    return null
  }

  const mode = await readModeOrNull(path)
  if (mode === null) {
    return null
  }

  if ((mode & OTHER_OR_GROUP_PERMISSIONS) !== NO_PERMISSION_BITS_SET) {
    return `Warning: ${path} is readable by other users. Run: chmod 600 "${path}"`
  }
  return null
}

async function readModeOrNull (path: string): Promise<number | null> {
  try {
    const stats = await stat(path)
    return stats.mode
  } catch {
    // Missing file (or unreadable) is not a permissions warning here;
    // callers already handle "file does not exist" separately.
    return null
  }
}
