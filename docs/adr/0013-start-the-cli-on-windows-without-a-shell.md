# 13. Start the orca CLI on Windows without a shell

Date: 2026-11-24

## Status

Accepted

## Context

On Windows the `orca` CLI on PATH is `orca.cmd`. Node 18.20.2, 20.12.2 and later refuse
`execFile('orca.cmd')` without a shell (EINVAL). Going through `cmd.exe` means cmd's own parsing
of every argument, and `orca.cmd` forwards `%*`, so arguments are parsed twice. Orca's `orca.cmd`
does nothing but check its arguments and run `orca.exe` beside it (`set
"LAUNCHER=%SCRIPT_DIR%orca.exe"`). A plugin worker may also start without APPDATA or LOCALAPPDATA
(stablyai/orca#46975).

## Decision

- **Finding the CLI.** On PATH, look for `orca.exe` first, then `orca.cmd`.
- **A `.cmd` shim.** Read the launcher it names from its `LAUNCHER` line and run that `.exe` with
  `execFile`, with no shell and arguments passed as an array.
- **Fallback.** Only if a `.cmd` names no launcher, run it through
  `cmd.exe /d /s /c "<command line>"` with `windowsVerbatimArguments`. Every argument is quoted
  for the program and its cmd metacharacters escaped twice (the forward via `%*`), as cross-spawn
  does for command shims.
- **Environment.** Give the CLI APPDATA and LOCALAPPDATA, filled from the home folder when
  missing.
- **Opening URLs.** `rundll32 url.dll,FileProtocolHandler <url>` instead of `cmd /c start "" <url>`,
  so cmd's quoting and `start`'s title argument never apply.
- **Testing.** Unit tests swap in the platform, PATH, files and environment.

## Consequences

- No shell is involved with Orca's own shim, so no argument can be reinterpreted.
- This has not been run on a real Windows machine yet; the README says so.
- If Orca's shim changes shape, the cmd.exe fallback still works, just with more escaping.

## Alternatives considered

- **Always `shell: true`.** Every argument goes through cmd's parsing, which is easy to get wrong.
  Rejected.
- **Running `node` on a JS entry read from the shim.** Orca's shim runs a native launcher, not a
  script. Not needed.
