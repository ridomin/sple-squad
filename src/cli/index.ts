#!/usr/bin/env node
import { startCli } from './framework.ts'
import { createPlaylistCommands, resolvePlaylistProvider } from './commands/playlist.ts'
import { registerCommand } from './registry.ts'

for (const command of createPlaylistCommands(resolvePlaylistProvider)) {
  registerCommand(command)
}

export { parseCommandArguments, parseGlobalArguments } from './args.ts'
export type {
  CommandContext,
  CommandDefinition,
  GlobalFlags,
  ParsedCommand,
  ParsedInvocation
} from './args.ts'
export {
  EXIT_CODES,
  PartialFailureError,
  formatErrorMessage,
  formatErrorOutput,
  getExitCode,
  getPartialFailureExitCode
} from './exit-codes.ts'
export {
  getRootHelpText,
  getRootHelpText as getHelpText,
  getVersion,
  runCli,
  runCli as run,
  startCli
} from './framework.ts'
export type { CliIO, RunCliOptions } from './framework.ts'
export {
  formatJson,
  formatOutput,
  formatQuiet,
  formatRows,
  selectOutputMode
} from './output.ts'
export type { OutputColumn, OutputMode, OutputOptions } from './output.ts'
export { parsePlaylistStdin, readStdin, resolvePlaylistArguments } from './stdin.ts'
export { clearProgressIndicators, ProgressIndicator } from './progress.ts'
export { configureLogging, createLogger, redactSecrets } from './logger.ts'
export { getRegisteredCommands, registerCommand } from './registry.ts'
export { registerSensitiveValue } from '../core/security/secrets.ts'
export { writeCliMessage } from './messages.ts'
export type { MessageKind } from './messages.ts'

startCli(import.meta.url)
