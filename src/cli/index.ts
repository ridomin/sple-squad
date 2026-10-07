#!/usr/bin/env node
// Minimal CLI entrypoint for M0 (issue #1): proves the build/bin wiring works
// end-to-end. Real command parsing/dispatch lands in later issues — this only
// handles --version and --help per CLI-1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getVersion(): string {
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

export function getHelpText(): string {
  return [
    'sple - manage music-streaming playlists from the command line',
    '',
    'Usage: sple [--version] [--help]',
    '',
    'Options:',
    '  --version   Print the sple version and exit',
    '  --help      Show this help text and exit',
    '',
    'Commands are not implemented yet (see milestone M0, issues #2-#8).',
  ].join('\n');
}

export function run(argv: string[]): number {
  if (argv.includes('--version')) {
    console.log(`sple ${getVersion()}`);
    return 0;
  }

  if (argv.includes('--help') || argv.length === 0) {
    console.log(getHelpText());
    return 0;
  }

  console.error(`sple: unknown command or option: ${argv.join(' ')}`);
  return 1;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
