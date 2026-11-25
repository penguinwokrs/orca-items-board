# Architecture decision records

Decisions behind the Bot Items Board, in [Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Title, Status, Context, Decision, Consequences, and Alternatives considered where there were any.
A new decision gets the next number; a changed one gets a new record that supersedes the old.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-read-items-through-the-orca-cli.md) | Read Items through the `orca` CLI from a trusted worker, by polling | Accepted |
| [0002](0002-board-as-a-custom-editor.md) | Show the board in the main area as a custom editor; keep its file inside a checkout's `.git` | Accepted (file location superseded by 0011) |
| [0003](0003-details-in-a-floating-box.md) | Show an Item's details in a floating box over the board | Accepted |
| [0004](0004-answer-in-orca-until-an-owner-api.md) | Answer in Orca until plugins can answer as the owner; keep answer-in-place behind a flag | Accepted (answer-in-place deferred) |
| [0005](0005-requests-from-chats.md) | Build the request list from chats; name requests after their Items; let the owner fix them | Accepted (requests per ask deferred) |
| [0006](0006-save-request-edits-in-settings.md) | Save request edits in a plugin setting, compactly, and show every save failure | Accepted (storage superseded by 0012) |
| [0007](0007-archive-requests-by-rule.md) | Archive requests by rule: all Items closed for N days; nothing saved | Accepted (manual archive deferred) |
| [0008](0008-language-and-first-run.md) | Follow Orca's display language (English by default); open the board once on first run | Accepted |
| [0009](0009-public-repository-and-demo-data.md) | Keep the public repository free of private data: demo data only, and a check before every push | Accepted |
| [0010](0010-status-bar-shows-needs-you.md) | The status bar shows what needs you on the board; it doesn't open an Item | Accepted |
| [0011](0011-board-folder-in-app-data.md) | Keep the board file in the plugin's own app-data folder, registered as a hidden folder project | Accepted (supersedes part of 0002) |
| [0012](0012-request-edits-in-plugin-storage.md) | Keep request edits in the plugin's storage (`storage:own`) | Accepted (supersedes part of 0006) |
| [0013](0013-start-the-cli-on-windows-without-a-shell.md) | Start the orca CLI on Windows without a shell | Accepted |
| [0015](0015-incremental-request-search.md) | Search the request list as you type, with no delay; draw the list a screenful at a time | Accepted |

Related: [docs/answer-in-place.md](../answer-in-place.md) records the deferred answer-in-place UI.
