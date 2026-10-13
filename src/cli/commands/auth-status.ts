import type { AuthStatus, Provider } from '../../core/provider/index.ts'
import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { formatOutput } from '../output.ts'
import { registerCommand } from '../registry.ts'

const commandPath = ['auth', 'status']
const NO_POSITIONAL_ARGUMENTS = 0
const NO_SCOPES = 0
const MS_PER_MINUTE = 60_000
const EXPIRY_WARNING_MINUTES = 5
const EXPIRY_WARNING_MS = EXPIRY_WARNING_MINUTES * MS_PER_MINUTE

export interface AuthStatusOutput {
  providers: Array<AuthStatus & {
    id: string
    refreshTokenExpiresAt?: string
  }>
}

export type ProviderResolver = (context: CommandContext) => readonly Provider[]

export function createAuthStatusCommand (
  providers: ProviderResolver = context => getRegisteredProviders({ config: context.config }),
  now: () => Date = () => new Date()
): CommandDefinition {
  return {
    path: commandPath,
    description: 'Show authentication status',
    helpText: [
      'Usage: sple auth status [--provider <id>]',
      '',
      'Without --provider, shows the status of every registered provider.'
    ].join('\n'),
    run: async context => {
      if (context.positionals.length > NO_POSITIONAL_ARGUMENTS) {
        throw new UsageError('sple auth status does not accept positional arguments')
      }
      const selected = selectProviders(context, providers(context))
      const statuses = await Promise.all(selected.map(async provider => ({
        id: provider.id,
        ...await provider.auth.status()
      })))
      const output: AuthStatusOutput = { providers: statuses }
      if (context.outputMode === 'json' || context.outputMode === 'quiet') {
        const quietIds = statuses.filter(status => status.loggedIn).map(status => status.id)
        context.stdout.write(formatOutput({ mode: context.outputMode, value: output, quietIds }))
        return
      }
      const nowMs = now().getTime()
      const lines: string[] = []
      for (const [index, status] of statuses.entries()) {
        const displayName = selected[index]?.displayName ?? status.id
        lines.push(...describeStatus(displayName, status, nowMs, context))
      }
      context.stdout.write(`${lines.join('\n')}\n`)
    }
  }
}

export function selectProviders (
  context: CommandContext,
  providers: readonly Provider[]
): readonly Provider[] {
  if (context.global.provider === undefined) return providers
  const provider = providers.find(candidate => candidate.id === context.provider)
  if (provider !== undefined) return [provider]
  const registered = providers.map(candidate => candidate.id).join(', ')
  throw new UsageError(`Unknown provider: ${context.provider}. Registered providers: ${registered}`)
}

function describeStatus (
  displayName: string,
  status: AuthStatus & { id: string },
  nowMs: number,
  context: CommandContext
): string[] {
  const lines = [`${displayName} (${status.id}): ${status.loggedIn ? 'logged in' : 'not logged in'}`]
  if (status.user !== undefined) {
    const name = status.user.displayName === undefined ? '' : `${status.user.displayName} `
    lines.push(`  User: ${name}(${status.user.id})`)
  }
  lines.push(`  Scopes: ${status.scopes.length === NO_SCOPES ? '(none)' : status.scopes.join(' ')}`)
  if (status.expiresAt !== undefined) {
    const expiresMs = Date.parse(status.expiresAt)
    const expired = expiresMs <= nowMs
    lines.push(`  Token expires: ${status.expiresAt}${expired ? ' (expired)' : ''}`)
    if (expired) {
      context.stderr.write(`Warning: ${displayName} access token has expired; it will be refreshed on next use\n`)
    } else if (expiresMs - nowMs < EXPIRY_WARNING_MS) {
      context.stderr.write(`Warning: ${displayName} access token expires in less than 5 minutes\n`)
    }
  }
  return lines
}

registerCommand(createAuthStatusCommand())
