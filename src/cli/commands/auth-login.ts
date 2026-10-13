import { UsageError } from '../../core/provider/errors.ts'
import {
  loginSpotify,
  type SpotifyLoginDependencies,
  type SpotifyLoginMode,
  type SpotifyLoginOptions,
  type SpotifyLoginResult
} from '../../provider/spotify/index.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { registerCommand } from '../registry.ts'

const commandPath = ['auth', 'login']
const NO_POSITIONAL_ARGUMENTS = 0

export function createAuthLoginCommand (
  dependencies: SpotifyLoginDependencies = {},
  login: typeof loginSpotify = loginSpotify
): CommandDefinition {
  return {
    path: commandPath,
    description: 'Log in to a music provider',
    helpText: [
      'Usage: sple auth login [--provider spotify] [--no-browser|--manual]',
      '',
      'Options:',
      '  --provider <id>  Select the provider (spotify only)',
      '  --no-browser     Print the authorization URL and wait for the callback',
      '  --manual         Paste the redirected URL instead of waiting for a callback'
    ].join('\n'),
    options: {
      'no-browser': { type: 'boolean' },
      manual: { type: 'boolean' }
    },
    run: async context => {
      await runAuthLogin(context, dependencies, login)
    }
  }
}

async function runAuthLogin (
  context: CommandContext,
  dependencies: SpotifyLoginDependencies,
  login: typeof loginSpotify
): Promise<void> {
  const { flags, config: { spotifyClientId }, stderr, stdout } = context
  const { 'no-browser': noBrowser, manual } = flags
  if (context.provider !== 'spotify') {
    throw new UsageError('sple auth login currently supports only --provider spotify')
  }
  if (context.positionals.length > NO_POSITIONAL_ARGUMENTS) {
    throw new UsageError('sple auth login does not accept positional arguments')
  }
  if (noBrowser === true && manual === true) {
    throw new UsageError('--no-browser and --manual cannot be used together')
  }

  if (spotifyClientId === null) {
    throw new UsageError('Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment.')
  }

  const mode: SpotifyLoginMode = manual === true
    ? 'manual'
    : noBrowser === true
      ? 'no-browser'
      : 'loopback'
  const options: SpotifyLoginOptions = { clientId: spotifyClientId, mode }
  const result = await login(options, {
    writeStderr: message => { stderr.write(`${message}\n`) },
    ...dependencies
  })
  stdout.write(formatLoginSuccess(result))
}

function formatLoginSuccess (result: SpotifyLoginResult): string {
  const grantedScopes = result.scopes.join(', ')
  const lines = [
    'Logged in to Spotify',
    `User: ${result.displayName ?? result.userId}`,
    `Scopes: ${grantedScopes === '' ? 'none' : grantedScopes}`
  ]
  if (result.expiresAt !== undefined) {
    lines.push(`Token expires: ${result.expiresAt}`)
  }
  return `${lines.join('\n')}\n`
}

registerCommand(createAuthLoginCommand())
