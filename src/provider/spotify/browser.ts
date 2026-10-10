import { spawn } from 'node:child_process'
import { once } from 'node:events'

async function runBrowserCommand (command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { stdio: 'ignore' })
  await once(child, 'spawn')
  child.unref()
}

/** Opens the system browser without a shell, preferring WSL's Windows bridge when available. */
export async function openSystemBrowser (url: string): Promise<void> {
  if (process.platform === 'win32') {
    await runBrowserCommand('rundll32.exe', ['url.dll,FileProtocolHandler', url])
    return
  }

  const isWsl = process.platform === 'linux' && (
    process.env.WSL_DISTRO_NAME !== undefined || process.env.WSL_INTEROP !== undefined
  )
  if (isWsl) {
    try {
      await runBrowserCommand('wslview', [url])
      return
    } catch {
      await runBrowserCommand('rundll32.exe', ['url.dll,FileProtocolHandler', url])
      return
    }
  }

  await runBrowserCommand(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
}
