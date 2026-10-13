import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { ProviderError } from '../../core/provider/errors.ts'
import type { LoopbackListener } from './auth-types.ts'

const CALLBACK_PATH = '/callback'
const BAD_REQUEST_STATUS = 400
const SUCCESS_STATUS = 200
const DYNAMIC_PORT = 0
const EMPTY_LENGTH = 0
const AUTHORIZATION_SUCCESS_HTML = '<!doctype html><html><body>Authorization successful. You can close this window.</body></html>'

type CallbackOutcome =
  | { kind: 'ignore' }
  | { kind: 'fail', error: Error }
  | { kind: 'success', code: string }

function callbackUrlFrom (request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? '/', 'http://127.0.0.1')
  } catch {
    return null
  }
}

function outcomeFromUrl (callbackUrl: URL, expectedState: string): CallbackOutcome {
  const { pathname, searchParams } = callbackUrl
  if (pathname !== CALLBACK_PATH) {
    return { kind: 'ignore' }
  }

  const state = searchParams.get('state')
  if (state === null) {
    return { kind: 'ignore' }
  }
  if (state !== expectedState) {
    return { kind: 'fail', error: new ProviderError('State validation failed') }
  }

  const oauthError = searchParams.get('error')
  if (oauthError !== null) {
    const safeError = /^[a-z_]{1,64}$/v.test(oauthError) ? oauthError : 'unknown'
    return { kind: 'fail', error: new ProviderError(`OAuth error: ${safeError}`) }
  }
  const code = searchParams.get('code')
  if (code === null || code.length === EMPTY_LENGTH) {
    return { kind: 'fail', error: new ProviderError('Authorization callback did not include a code') }
  }
  return { kind: 'success', code }
}

function callbackOutcome (request: IncomingMessage, expectedHost: string, expectedState: string): CallbackOutcome {
  if (request.method !== 'GET' || request.headers.host !== expectedHost) {
    return { kind: 'ignore' }
  }
  const callbackUrl = callbackUrlFrom(request)
  return callbackUrl === null
    ? { kind: 'ignore' }
    : outcomeFromUrl(callbackUrl, expectedState)
}

function sendReply (response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  response.end(body)
}

/** Binds an ephemeral 127.0.0.1 port and waits for one valid OAuth callback. */
export async function createLoopbackListener (expectedState: string): Promise<LoopbackListener> {
  let expectedHost = ''
  let resolveCode: ((code: string) => void) | undefined = undefined
  let rejectCode: ((error: Error) => void) | undefined = undefined
  // eslint-disable-next-line promise/avoid-new -- a deferred result is settled by the later HTTP callback
  const codeResult = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  void codeResult.catch(() => undefined)

  const server: Server = createServer((request, response) => {
    const outcome = callbackOutcome(request, expectedHost, expectedState)
    if (outcome.kind === 'ignore') {
      sendReply(response, BAD_REQUEST_STATUS, 'Invalid authorization callback.')
      return
    }
    if (outcome.kind === 'fail') {
      sendReply(response, BAD_REQUEST_STATUS, 'Invalid authorization callback.')
      rejectCode?.(outcome.error)
      return
    }
    sendReply(response, SUCCESS_STATUS, AUTHORIZATION_SUCCESS_HTML)
    resolveCode?.(outcome.code)
  })

  server.listen(DYNAMIC_PORT, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new ProviderError('Could not start Spotify authorization listener')
  }
  expectedHost = `127.0.0.1:${String(address.port)}`

  return {
    redirectUri: `http://${expectedHost}${CALLBACK_PATH}`,
    waitForCode: async () => await codeResult,
    close: async () => {
      server.close()
      await once(server, 'close')
    }
  }
}
