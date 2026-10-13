import { UsageError } from '../core/provider/errors.ts'
import type { CommandDefinition } from './args.ts'
import { createExportCommand } from './commands/export.ts'

const registeredCommands: CommandDefinition[] = [createExportCommand()]

export function registerCommand (command: CommandDefinition): void {
  const key = command.path.join(' ')
  if (registeredCommands.some(existing => existing.path.join(' ') === key)) {
    throw new UsageError(`Duplicate command registration: ${key}`)
  }
  registeredCommands.push(command)
}

export function getRegisteredCommands (): readonly CommandDefinition[] {
  return registeredCommands
}
