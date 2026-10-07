#!/usr/bin/env node
// Minimal CLI entrypoint for M0 (issue #1): proves the build/bin wiring works
// end-to-end. Real command parsing/dispatch lands in later issues — this only
// handles --version and --help per CLI-1.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const EXIT_OK = 0
const EXIT_ERROR = 1
const NO_ARGS_LENGTH = 0
const PROCESS_ARGV_SCRIPT_INDEX = 1
const PROCESS_ARGV_USER_ARGS_START = 2

const moduleDir = dirname(fileURLToPath(import.meta.url))

interface PackageManifest {
  version: string
}

function isPackageManifest (value: unknown): value is PackageManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { version?: unknown }).version === 'string'
  )
}

export function getVersion (): string {
  const pkgPath = join(moduleDir, '..', '..', 'package.json')
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!isPackageManifest(parsed)) {
    throw new Error(`invalid package.json at ${pkgPath}`)
  }
  return parsed.version
}

export function getHelpText (): string {
  return [
    'sple - manage music-streaming playlists from the command line',
    '',
    'Usage: sple [--version] [--help]',
    '',
    'Options:',
    '  --version   Print the sple version and exit',
    '  --help      Show this help text and exit',
    '',
    'Commands are not implemented yet (see milestone M0, issues #2-#8).'
  ].join('\n')
}

export function run (argv: string[]): number {
  if (argv.includes('--version')) {
    // eslint-disable-next-line no-console -- CLI output is the intended side effect
    console.log(`sple ${getVersion()}`)
    return EXIT_OK
  }

  if (argv.includes('--help') || argv.length === NO_ARGS_LENGTH) {
    // eslint-disable-next-line no-console -- CLI output is the intended side effect
    console.log(getHelpText())
    return EXIT_OK
  }

  // eslint-disable-next-line no-console -- CLI output is the intended side effect
  console.error(`sple: unknown command or option: ${argv.join(' ')}`)
  return EXIT_ERROR
}

const isMain = process.argv[PROCESS_ARGV_SCRIPT_INDEX] === fileURLToPath(import.meta.url)
if (isMain) {
  process.exitCode = run(process.argv.slice(PROCESS_ARGV_USER_ARGS_START))
}
