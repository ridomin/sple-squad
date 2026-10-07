// Parsing and permission checks for the `.env` config file (ADR 0004 §1 and
// Amendment 1 "`.env` syntax"). sple never writes `.env` — it only reads and
// validates it.
import { constants as fsConstants } from 'node:fs'
import { stat } from 'node:fs/promises'

const COMMENT_PREFIX = '#'
const KEY_VALUE_SEPARATOR = '='
const EMPTY_LENGTH = 0
const NOT_FOUND = -1
const MIN_QUOTED_LENGTH = 2
const QUOTE_LENGTH = 1
const LINE_SPLIT_REGEXP = /\r\n|\n/v

// Parses the subset of dotenv syntax ports must accept (Amendment 1):
// - one `KEY=value` per line; blank lines and lines starting with `#` are
//   ignored
// - values may be wrapped in single or double quotes, which are removed
// - no variable expansion, no multi-line values
export function parseDotEnv (content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split(LINE_SPLIT_REGEXP)) {
    const line = rawLine.trim()
    if (line.length === EMPTY_LENGTH || line.startsWith(COMMENT_PREFIX)) {
      continue
    }

    const separatorIndex = line.indexOf(KEY_VALUE_SEPARATOR)
    if (separatorIndex === NOT_FOUND) {
      continue
    }

    const key = line.slice(EMPTY_LENGTH, separatorIndex).trim()
    if (key.length === EMPTY_LENGTH) {
      continue
    }

    const rawValue = line.slice(separatorIndex + QUOTE_LENGTH).trim()
    result[key] = unquote(rawValue)
  }

  return result
}

function unquote (value: string): string {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= MIN_QUOTED_LENGTH
  const isSingleQuoted = value.startsWith('\'') && value.endsWith('\'') && value.length >= MIN_QUOTED_LENGTH
  if (isDoubleQuoted || isSingleQuoted) {
    return value.slice(QUOTE_LENGTH, -QUOTE_LENGTH)
  }
  return value
}

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
