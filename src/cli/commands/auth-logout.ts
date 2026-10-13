import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { registerCommand } from '../registry.ts'
import { selectProviders, type ProviderResolver } from './auth-status.ts'

const commandPath = ['auth', 'logout']
const NO_POSITIONAL_ARGUMENTS = 0
const NO_DELETED_DATA = 0

export function createAuthLogoutCommand (
  providers: ProviderResolver = context => getRegisteredProviders({ config: context.config })
): CommandDefinition {
  return {
    path: commandPath,
    description: 'Remove local credentials',
    helpText: [
      'Usage: sple auth logout [--provider <id> | --all]',
      '',
      'Removes local credentials. Providers without revocation support explain how to revoke access.'
    ].join('\n'),
    options: {
      all: { type: 'boolean' }
    },
    run: async context => {
      await runAuthLogout(context, providers)
    }
  }
}

async function runAuthLogout (
  context: CommandContext,
  providers: ProviderResolver
): Promise<void> {
  validateLogoutInvocation(context)
  const selected = context.flags.all === true
    ? providers(context)
    : selectProviders(context, providers(context))
  const results = await Promise.all(selected.map(async provider => ({
    provider,
    result: await provider.auth.logout()
  })))
  if (context.outputMode === 'quiet') return
  for (const { provider, result } of results) {
    const revocation = result.revoked ? 'Access revoked.' : 'Local credentials removed; access was not revoked.'
    const deleted = result.deletedData.length === NO_DELETED_DATA ? '' : ` Removed: ${result.deletedData.join(', ')}.`
    context.stdout.write(`${provider.displayName}: ${revocation}${deleted}\n`)
    if (result.notice !== undefined) context.stderr.write(`sple: warning: ${result.notice}\n`)
  }
}

function validateLogoutInvocation (context: CommandContext): void {
  if (context.positionals.length > NO_POSITIONAL_ARGUMENTS) {
    throw new UsageError('sple auth logout does not accept positional arguments')
  }
  if (context.outputMode === 'json') {
    throw new UsageError('sple auth logout does not support --json')
  }
  if (context.flags.all === true && context.global.provider !== undefined) {
    throw new UsageError('--all cannot be used with --provider')
  }
}

registerCommand(createAuthLogoutCommand())
