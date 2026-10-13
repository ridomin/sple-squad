import type { AuthStatus, Provider } from '../../core/provider/index.ts'
import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { formatOutput, type OutputColumn } from '../output.ts'
import { registerCommand } from '../registry.ts'

const commandPath = ['auth', 'status']
const NO_POSITIONAL_ARGUMENTS = 0
const STATUS_COLUMNS: OutputColumn[] = [
  { key: 'provider', label: 'provider' },
  { key: 'loggedIn', label: 'logged in' },
  { key: 'user', label: 'user', flexible: true },
  { key: 'userId', label: 'user id' },
  { key: 'scopes', label: 'scopes', flexible: true },
  { key: 'expiresAt', label: 'expires' }
]

export interface AuthStatusOutput {
  providers: Array<AuthStatus & {
    id: string
    refreshTokenExpiresAt?: string
  }>
}

export type ProviderResolver = (context: CommandContext) => readonly Provider[]

export function createAuthStatusCommand (
  providers: ProviderResolver = context => getRegisteredProviders({ config: context.config })
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
      const rows = statuses.map(status => ({
        provider: status.id,
        loggedIn: status.loggedIn,
        user: status.user?.displayName ?? '',
        userId: status.user?.id ?? '',
        scopes: status.scopes.join(' '),
        expiresAt: status.expiresAt
      }))
      const quietIds = statuses.filter(status => status.loggedIn).map(status => status.id)
      context.stdout.write(formatOutput({
        mode: context.outputMode,
        value: output,
        columns: STATUS_COLUMNS,
        rows,
        quietIds,
        outputOptions: { stdoutIsTTY: context.stdoutIsTTY }
      }))
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

registerCommand(createAuthStatusCommand())
