// Starting the orca CLI on each platform, with the platform swapped in.
import { assert, test } from 'orca/testing'
import { cliEnv, cmdLauncher, commandArgs, escapeCmdArgument, openCommand, orcaCommand, resolveOrca } from './cli'

const ORCA_CMD = `@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "LAUNCHER=%SCRIPT_DIR%orca.exe"
"%LAUNCHER%" %*
`

function windows(files: Record<string, string>, env: Record<string, string> = {}) {
  return {
    platform: 'win32' as const,
    env: { Path: 'C:\\Windows;C:\\Program Files\\Orca\\resources\\bin', ...env },
    home: 'C:\\Users\\u',
    exists: (p: string) => p in files,
    read: (p: string) => files[p] ?? null
  }
}

test('Windows: orca.exe on PATH comes first; otherwise orca.cmd', () => {
  const bin = 'C:\\Program Files\\Orca\\resources\\bin'
  assert.equal(resolveOrca(undefined, windows({ [`${bin}\\orca.exe`]: '', [`${bin}\\orca.cmd`]: ORCA_CMD })), `${bin}\\orca.exe`)
  assert.equal(resolveOrca(undefined, windows({ [`${bin}\\orca.cmd`]: ORCA_CMD })), `${bin}\\orca.cmd`)
  assert.equal(resolveOrca(' D:\\tools\\orca.exe ', windows({})), 'D:\\tools\\orca.exe')
  assert.equal(resolveOrca(undefined, windows({})), null)
})

test('Windows: a .cmd shim runs the launcher it names, directly, with no shell', () => {
  const bin = 'C:\\Program Files\\Orca\\resources\\bin'
  const deps = windows({ [`${bin}\\orca.cmd`]: ORCA_CMD, [`${bin}\\orca.exe`]: '' })
  assert.equal(cmdLauncher(`${bin}\\orca.cmd`, deps), `${bin}\\orca.exe`)
  const command = orcaCommand(`${bin}\\orca.cmd`, deps)
  assert.deepEqual(command, { file: `${bin}\\orca.exe`, prefix: [], verbatim: false })
  // Arguments go as they are: Node quotes them for the .exe.
  assert.deepEqual(commandArgs(command, `${bin}\\orca.cmd`, ['bot', 'item', 'list', '--bot', 'qa bot', '--json']), [
    'bot',
    'item',
    'list',
    '--bot',
    'qa bot',
    '--json'
  ])
})

test('Windows: a .cmd that names no launcher goes through cmd.exe, every argument escaped', () => {
  const deps = windows({ 'C:\\x\\orca.cmd': '@echo off\r\nnode "%~dp0cli.js" %*\r\n' }, { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
  const command = orcaCommand('C:\\x\\orca.cmd', deps)
  assert.deepEqual(command, { file: 'C:\\Windows\\System32\\cmd.exe', prefix: ['/d', '/s', '/c'], verbatim: true })
  const args = commandArgs(command, 'C:\\x\\orca.cmd', ['repo', 'add', '--path', 'C:\\Users\\A & B\\orca-items-board'])
  assert.equal(args.length, 4)
  const line = args[3]!
  assert.ok(line.startsWith('"') && line.endsWith('"'))
  // Metacharacters can't break out: & and spaces are escaped, twice for the %* forward.
  assert.ok(!/[^^]&/.test(line))
  assert.equal(escapeCmdArgument('a&b', false), '^"a^&b^"')
  assert.equal(escapeCmdArgument('say "hi"', false), '^"say^ \\^"hi\\^"^"')
  assert.equal(escapeCmdArgument('C:\\dir\\', false), '^"C:\\dir\\\\^"')
  assert.equal(escapeCmdArgument('%PATH%'), '^^^"^^^%PATH^^^%^^^"')
})

test('Windows: APPDATA and LOCALAPPDATA are filled from the home folder when missing', () => {
  const env = cliEnv({ platform: 'win32', env: { PATH: 'x' }, home: 'C:\\Users\\u' })
  assert.equal(env.APPDATA, 'C:\\Users\\u\\AppData\\Roaming')
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\u\\AppData\\Local')
  assert.equal(env.PATH, 'x')
  // Set ones are kept; other platforms are left alone.
  assert.equal(cliEnv({ platform: 'win32', env: { APPDATA: 'D:\\a', LOCALAPPDATA: 'D:\\l' }, home: 'C:\\Users\\u' }).APPDATA, 'D:\\a')
  assert.equal(cliEnv({ platform: 'linux', env: {}, home: '/h/u' }).APPDATA, undefined)
})

test('elsewhere: the binary runs as it is; Linux finds Orca’s shim folder', () => {
  assert.deepEqual(orcaCommand('/usr/bin/orca', { platform: 'linux' }), { file: '/usr/bin/orca', prefix: [], verbatim: false })
  const shim = '/h/u/.config/orca/linux-orca-cli-shim/orca'
  assert.equal(resolveOrca(undefined, { platform: 'linux', env: { PATH: '/usr/bin' }, home: '/h/u', exists: (p) => p === shim }), shim)
  assert.equal(resolveOrca(undefined, { platform: 'darwin', env: { PATH: '/opt/bin:/usr/bin' }, home: '/Users/u', exists: (p) => p === '/opt/bin/orca' }), '/opt/bin/orca')
})

test('opening a URL: xdg-open, open, and on Windows rundll32 (no cmd.exe quoting)', () => {
  const url = 'orca://bot/abc-123'
  assert.deepEqual(openCommand(url, 'linux'), ['xdg-open', [url]])
  assert.deepEqual(openCommand(url, 'darwin'), ['open', [url]])
  assert.deepEqual(openCommand(url, 'win32'), ['rundll32', ['url.dll,FileProtocolHandler', url]])
})
