# QA: the request list from item origins

How to try the board's origin-based request list (`feat/request-origin`, ADR 0014) on a **dev Orca**
built from the Orca branch that records item origins (penguinwokrs/orca `feat/item-origin-48086`,
stablyai/orca#48086), and what to check.

Never use your own Orca for this. Everything below runs in a dev Orca with its own profile
(userData), and every `orca` command goes to that dev Orca through its own CLI wrapper.

## 1. Build and start the dev Orca

Prerequisites (Node 24, pnpm, Bun, a C++ toolchain) are in the Orca repo's `docs/development.md`.

```sh
git clone https://github.com/penguinwokrs/orca.git orca-origin
cd orca-origin
git checkout feat/item-origin-48086
pnpm install
```

Start it with a profile of its own. Pick an empty folder outside your real Orca's data, for example
`~/orca-qa/profile` (Windows: `%USERPROFILE%\orca-qa\profile`).

macOS and Linux (sh):

```sh
ORCA_DEV_USER_DATA_PATH="$HOME/orca-qa/profile" pnpm dev
```

Windows (PowerShell):

```powershell
$env:ORCA_DEV_USER_DATA_PATH = "$env:USERPROFILE\orca-qa\profile"
pnpm dev
```

- The launcher prints an `ORCA_DEV_INSTANCE` line, and writes `out/dev-instance.json`. Its
  `userData` must be the folder you chose.
- `pnpm dev` from a linked Git worktree already gets a per-worktree profile; the variable just makes
  it explicit.
- To isolate further, also give the dev Orca its own home (`HOME=…` on macOS/Linux,
  `$env:USERPROFILE=…` on Windows). Then the bots' agents (Claude, Codex) need signing in there
  again. The profile alone is enough for the board.

## 2. Use the dev Orca's CLI, not your own

`pnpm dev` writes a CLI wrapper that is bound to the dev profile:

| OS | Dev CLI |
| --- | --- |
| macOS, Linux | `<orca-origin>/out/bin/orca` |
| Windows | `<orca-origin>\out\bin\orca.cmd` |

Below, `DEV_ORCA` stands for that full path. In sh: `DEV_ORCA="$PWD/out/bin/orca"`. In PowerShell:
`$DEV_ORCA = "$PWD\out\bin\orca.cmd"`, then run it as `& $DEV_ORCA …`.

- Check that it reaches the dev Orca: `"$DEV_ORCA" bot list --json` lists the dev profile's bots
  (none on a new profile), not your own.
- A plain `orca` in an ordinary terminal reaches your own Orca. Don't use it here.

## 3. Install the plugin branch into the dev Orca

Load a checkout of the branch as a development plugin (it reloads when its files change):

```sh
git clone https://github.com/penguinwokrs/orca-items-board.git
git -C orca-items-board checkout feat/request-origin
"$DEV_ORCA" plugin dev load "$PWD/orca-items-board" --json
```

(`"$DEV_ORCA" plugin install penguinwokrs/orca-items-board@feat/request-origin` may also work; the
branch name has a `/`, so if it does not resolve, use the folder.)

It stops with `approval_required` the first time. Read what it asks for (README, "Access it asks
for"), then re-run the same command with the `--approve <fingerprint>` it prints.

Then, in the dev Orca, **Settings → Plugins → Bot Items Board**:

- **orca CLI path**: the dev CLI's full path from step 2. Empty also usually works (the dev
  launcher puts `out/bin` first on the PATH the plugin inherits); the setting makes sure.
- **Board folder**: an empty folder of its own, such as `~/orca-qa/board`. Left empty, it would be
  the same app data folder your own Orca's board uses.

Open the board from the status bar's `Needs you n` or the command palette (`Items: Open Board`).

Check the items carry origins: `"$DEV_ORCA" bot item list --bot <name> --all --json` prints
`origin: { rootKey, kind, at, request }` and `fromItem` on each item.

## 4. Make the scenarios

Make two bots in the dev Orca, called `alpha` and `beta` here, with a signed-in agent. Ask in each
bot's **Home** chat. Wording is up to you; the bots must make items, not do the work.

1. **One request, three items on one bot.** In alpha's Home: "Track this as three items, no work
   yet: draft a release checklist, review it with QA, post it."
2. **A coordinator and a helper.** In alpha's Home: "Make an item for fixing the flaky login test,
   and have beta make an item to QA it (`orca bot item add --for bot:beta`, `--from-item` your
   item)." alpha's and beta's items must print the same `origin.rootKey`.
3. **Two requests in one busy Home chat.** Scenarios 1 and 2 are already two messages in alpha's
   Home. Add a third: "Make one item: rotate the staging password."
4. **A group room.** Make a room with alpha and beta and ask in it for one item each.
5. **Old items.** Items made before origins have none. Either:
   - quick: open a file holding `{"source": "demo", "origins": true}` (any `.itemsboard` file in a
     workspace; see the plugin's `examples/demo-origins*.itemsboard`). Item #34 has no origin; or
   - live: make a few items on a dev Orca built from Orca's `main`, with the same profile, then
     restart the profile on `feat/item-origin-48086` and run scenarios 1 to 4.

## 5. What to check on the board

Request list (left):

- [ ] Scenario 1 is **one row**: named after alpha's message (shortened, on one line), with the
      three item titles under it, `3 items`, note `Home · alpha`.
- [ ] Hovering the row shows the whole message.
- [ ] Scenario 2 is **one row** with both bots in its note (`beta · alpha` or the other order) and
      both items.
- [ ] alpha's Home holds **one row per message** (scenarios 1, 2 and 3), not one for the chat.
- [ ] These rows show **no "Last ask"** line.
- [ ] The room (scenario 4) is **one row** named after its oldest item ("… +1 more"), note with the
      room's title and both bots. Its last ask shows when it reads like your words.
- [ ] Old items (scenario 5) sit in their chat's row (`Home`, "+N more"), as before.
- [ ] A row with a Needs you item comes first and stands out.
- [ ] No UUID, session id, `orca_session_id` or request key (`<session>:<id>`) anywhere.

Filter on and off:

- [ ] Choosing a row leaves exactly that request's items in the columns. Compare with
      `"$DEV_ORCA" bot item list --bot <name> --all --root-key <origin.rootKey> --json` for each bot.
- [ ] **All** brings every item back (except archived requests'; its row says how many it leaves
      out).
- [ ] The choice survives closing and reopening the board.
- [ ] `Needs you n` in the status bar goes back to **All**.

Item box:

- [ ] **Asked for** shows the message that asked (scenarios 1 to 3); not on room items.
- [ ] beta's QA item shows **Made from** `alpha #<n> <title>`; clicking it opens alpha's item.

Edits:

- [ ] Rename, **Merge into…**, moving an item to another or a **New request** from its box, and
      **Undo edits** work on origin rows and chat rows alike, and survive a refresh.

Empty state:

- [ ] With no bots (a new profile), the board loads with **All** and empty columns, and no error.
- [ ] With bots but no items, the same.

Language:

- [ ] With Orca in Japanese, the box says **依頼の言葉** and **元の Item**.

Stock Orca (optional): load the same plugin into a dev Orca built from Orca's `main`. The list must
look as before this change (one row per chat, a room's chats together), with no errors.

## Platforms

The steps are the same on Windows, macOS and Linux; only the paths and the shell differ. On
Windows, run `pnpm dev` from PowerShell and give the plugin the `.cmd` wrapper's path. That wrapper
names no `LAUNCHER`, so the plugin runs it through `cmd.exe` with each argument escaped (ADR 0013).
