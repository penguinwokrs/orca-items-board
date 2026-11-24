// Spawns the `orca` CLI for the worker. Always `--json`, an argument array, and a large buffer: a
// 100-item page with worker reports runs past Node's 1 MiB default.
//
// Windows: Node (18.20.2 / 20.12.2 and later) refuses to run a `.cmd` without a shell (EINVAL).
// Orca's `orca.cmd` only forwards to `orca.exe` beside it (`set "LAUNCHER=%SCRIPT_DIR%orca.exe"`),
// so the worker reads that name from the `.cmd` and runs the `.exe` itself, with no shell. Only
// when a `.cmd` names no launcher does it go through `cmd.exe`, every argument escaped for it.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { CliError, type OrcaRunner } from './board'
import type { Env, Platform } from './board-file'

const MAX_BUFFER = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

/** What the host gives the resolver: the real system by default, a stand-in in tests. */
export type SystemDeps = {
  platform?: Platform
  env?: Env
  home?: string
  exists?: (path: string) => boolean
  read?: (path: string) => string | null
}

function system(deps: SystemDeps) {
  const platform = deps.platform ?? process.platform
  return {
    platform,
    env: deps.env ?? process.env,
    home: deps.home ?? osHomedir(),
    exists: deps.exists ?? existsSync,
    read:
      deps.read ??
      ((path: string) => {
        try {
          return readFileSync(path, 'utf8')
        } catch {
          return null
        }
      }),
    path: platform === 'win32' ? win32 : posix
  }
}

/** How to start the CLI: a file to execute and the arguments that go before the command's own. */
export type OrcaCommand = { file: string; prefix: string[]; verbatim: boolean }

/**
 * The environment for the CLI. On Windows a worker may lack APPDATA and LOCALAPPDATA
 * (stablyai/orca#46975); they're filled in from the home folder so the CLI finds its data.
 */
export function cliEnv(deps: SystemDeps = {}): Env {
  const { platform, env, home, path } = system(deps)
  if (platform !== 'win32') {
    return env
  }
  return {
    ...env,
    APPDATA: env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: env.LOCALAPPDATA?.trim() || path.join(home, 'AppData', 'Local')
  }
}

/** Where Orca puts its CLI shim on Linux (seen on 1.4.272). Elsewhere: PATH, or the setting. */
function shimCandidates(deps: ReturnType<typeof system>): string[] {
  if (deps.platform !== 'linux') {
    return []
  }
  const config = deps.env.XDG_CONFIG_HOME ?? deps.path.join(deps.home, '.config')
  return [deps.path.join(config, 'orca/linux-orca-cli-shim/orca')]
}

function onPath(names: readonly string[], deps: ReturnType<typeof system>): string | null {
  const pathValue = deps.env.PATH ?? deps.env.Path ?? ''
  for (const dir of pathValue.split(deps.platform === 'win32' ? ';' : ':')) {
    for (const name of names) {
      if (dir && deps.exists(deps.path.join(dir, name))) {
        return deps.path.join(dir, name)
      }
    }
  }
  return null
}

/** The setting if given, else `orca` on PATH (on Windows `orca.exe`, then `orca.cmd`), else
 *  Orca's shim folder; null when none exists. */
export function resolveOrca(configured: string | undefined, deps: SystemDeps = {}): string | null {
  const sys = system(deps)
  if (configured && configured.trim()) {
    return configured.trim()
  }
  const names = sys.platform === 'win32' ? ['orca.exe', 'orca.cmd'] : ['orca']
  return onPath(names, sys) ?? shimCandidates(sys).find((path) => sys.exists(path)) ?? null
}

/** The launcher a Windows `.cmd` shim forwards to, read from its `set "LAUNCHER=%SCRIPT_DIR%…"`. */
export function cmdLauncher(cmdPath: string, deps: SystemDeps = {}): string | null {
  const sys = system(deps)
  const text = sys.read(cmdPath)
  const match = text?.match(/set\s+"LAUNCHER=%SCRIPT_DIR%([^"%\r\n]+)"/i)
  if (!match) {
    return null
  }
  const launcher = sys.path.join(sys.path.dirname(cmdPath), match[1]!.trim())
  return sys.exists(launcher) ? launcher : null
}

// cmd.exe's metacharacters, escaped with ^ (as cross-spawn does).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/**
 * One argument quoted for a program's own parser, then escaped for cmd.exe. `twice`: a `.cmd`
 * that forwards `%*` makes cmd.exe read the line a second time, so the escapes are doubled (as
 * cross-spawn does for command shims).
 */
export function escapeCmdArgument(arg: string, twice = true): string {
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  quoted = `"${quoted}"`.replace(CMD_META, '^$1')
  return twice ? quoted.replace(CMD_META, '^$1') : quoted
}

/** How to run the CLI at `binary` on this platform. */
export function orcaCommand(binary: string, deps: SystemDeps = {}): OrcaCommand {
  const sys = system(deps)
  if (sys.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
    const launcher = cmdLauncher(binary, deps)
    if (launcher) {
      return { file: launcher, prefix: [], verbatim: false }
    }
    // No launcher named: through cmd.exe, everything escaped (/d no AutoRun, /s keep the quotes).
    const comspec = sys.env.ComSpec || sys.env.COMSPEC || 'cmd.exe'
    return { file: comspec, prefix: ['/d', '/s', '/c'], verbatim: true }
  }
  return { file: binary, prefix: [], verbatim: false }
}

/** The arguments `execFile` gets for one CLI call. */
export function commandArgs(command: OrcaCommand, binary: string, args: readonly string[]): string[] {
  if (!command.verbatim) {
    return [...command.prefix, ...args]
  }
  const line = [binary.replace(CMD_META, '^$1'), ...args.map((arg) => escapeCmdArgument(arg))].join(' ')
  return [...command.prefix, `"${line}"`]
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

export function cliRunner(binary: string, deps: SystemDeps = {}): OrcaRunner {
  const command = orcaCommand(binary, deps)
  const env = cliEnv(deps)
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        command.file,
        commandArgs(command, binary, args),
        {
          maxBuffer: MAX_BUFFER,
          timeout: TIMEOUT_MS,
          windowsHide: true,
          windowsVerbatimArguments: command.verbatim,
          encoding: 'utf8',
          env: env as NodeJS.ProcessEnv
        },
        (error, stdout, stderr) => {
          // A refused command still prints its {ok:false} envelope, with a non-zero exit.
          const envelope = parseEnvelope(stdout)
          if (envelope?.ok === true) {
            resolve(envelope.result)
            return
          }
          if (envelope?.ok === false) {
            reject(new CliError(envelope.error?.message ?? 'orca refused the command', envelope.error?.code ?? 'cli_error'))
            return
          }
          const detail = (stderr || stdout || (error ? error.message : '')).trim().split('\n')[0]
          reject(new CliError(`orca ${args.slice(0, 3).join(' ')}: ${detail || 'no JSON output'}`, 'cli_failed'))
        }
      )
    })
}

/**
 * How the OS opens a URL. Windows uses `rundll32 url.dll,FileProtocolHandler <url>`: no cmd.exe,
 * so `start`'s title argument and cmd's quoting rules never apply.
 */
export function openCommand(url: string, platform: Platform = process.platform): [string, string[]] {
  switch (platform) {
    case 'darwin':
      return ['open', [url]]
    case 'win32':
      return ['rundll32', ['url.dll,FileProtocolHandler', url]]
    default:
      return ['xdg-open', [url]]
  }
}

/** Hands a URL to the OS, which passes `orca://` back to Orca. */
export function openWithOs(url: string): Promise<void> {
  const [command, args] = openCommand(url)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env: cliEnv() as NodeJS.ProcessEnv })
    child.once('error', (error) => reject(new CliError(`${command}: ${error.message}`, 'open_failed')))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
