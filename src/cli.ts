// Spawns the `orca` CLI for the worker. Always `--json`, an argument array (no shell), and a large
// buffer: a 100-item page with worker reports runs past Node's 1 MiB default.
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { CliError, type OrcaRunner } from './board'

const MAX_BUFFER = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

/** Where Orca puts its CLI shim on Linux (seen on 1.4.272). Elsewhere: PATH, or the setting. */
function shimCandidates(): string[] {
  if (process.platform !== 'linux') {
    return []
  }
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return [join(config, 'orca/linux-orca-cli-shim/orca')]
}

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name))) {
      return join(dir, name)
    }
  }
  return null
}

/** The setting if given, else `orca` on PATH, else Orca's shim folder; null when none exists. */
export function resolveOrca(configured: string | undefined): string | null {
  if (configured && configured.trim()) {
    return configured.trim()
  }
  return onPath(process.platform === 'win32' ? 'orca.cmd' : 'orca') ?? shimCandidates().find((path) => existsSync(path)) ?? null
}

type Envelope = { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } }

function parseEnvelope(stdout: string): Envelope | null {
  const text = stdout.trim()
  if (!text.startsWith('{')) {
    return null
  }
  try {
    return JSON.parse(text) as Envelope
  } catch {
    return null
  }
}

export function cliRunner(binary: string): OrcaRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        [...args],
        { maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          // A refused command still prints its {ok:false} envelope, with a non-zero exit.
          const envelope = parseEnvelope(stdout)
          if (envelope?.ok === true) {
            resolve(envelope.result)
            return
          }
          if (envelope?.ok === false) {
            reject(
              new CliError(
                envelope.error?.message ?? 'orca refused the command',
                envelope.error?.code ?? 'cli_error'
              )
            )
            return
          }
          const detail = (stderr || stdout || (error ? error.message : '')).trim().split('\n')[0]
          reject(new CliError(`orca ${args.slice(0, 3).join(' ')}: ${detail || 'no JSON output'}`, 'cli_failed'))
        }
      )
    })
}

/** Hands a URL to the OS (xdg-open, open, start), which passes `orca://` back to Orca. */
export function openWithOs(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (error) => reject(new CliError(`${command}: ${error.message}`, 'open_failed')))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
