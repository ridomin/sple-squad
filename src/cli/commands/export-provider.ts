import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { Provider } from '../../core/provider/provider.ts'
import type { CommandContext } from '../args.ts'

export function resolveExportProvider (context: CommandContext): Provider {
  const provider = getRegisteredProviders({ config: context.config })
    .find(candidate => candidate.id === context.provider)
  if (provider === undefined) {
    throw new UsageError(`Provider "${context.provider}" is not available`)
  }
  return provider
}
