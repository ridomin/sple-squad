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
  const failures: unknown[] = []
  for (const provider of selected) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential so first-failure order follows provider order
      const result = await provider.auth.logout()
      if (context.outputMode === 'quiet') continue
      context.stdout.write(`${result.revoked ? 'Revoked access with' : 'Logged out from'} ${provider.displayName}\n`)
      if (result.deletedData.length > NO_DELETED_DATA) context.stdout.write(`Deleted: ${result.deletedData.join(', ')}\n`)
      if (result.notice !== undefined) context.stdout.write(`${result.notice}\n`)
    } catch (error) {
      failures.push(error)
    }
  }
  const [firstFailure] = failures
  if (failures.length > NO_DELETED_DATA) throw firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure))
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
