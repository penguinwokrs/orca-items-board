# 15. Search the request list as you type, with no delay; draw the list a screenful at a time

Date: 2026-11-25

## Status

Accepted. (0014 is taken by the request list from item origins, on its own branch.)

## Context

With many requests the left list gets long, and finding one by scrolling is slow. The owner asked
for an incremental search: the list narrows with every key, not after a search button. Only if
that is too slow should it wait for a pause in typing (debounce), and that has to be decided by
measuring, with a large board (about 500 requests and 5,000 Items), against one frame (about 16 ms)
per key for matching and redrawing the list.

## Decision

- A search field sits above the list (above **All**): "Search requests" / 「依頼を検索」.
  - It matches the request's name (a rename included), its Items' titles and numbers (`#123`), its
    bots, its chats' names and its last ask.
  - Matching ignores case and folds with NFKC (full-width and half-width alike). Words split on
    spaces, full-width ones too, and every word must be found (AND), each anywhere in the request.
  - Matches are marked in the row. A word found only in an Item the row doesn't show (its title
    isn't listed, or it matched by number) adds that Item as one line, `#n title`.
  - Archived requests are searched too. Matches show under **Archived**, opened while searching.
  - "n of m requests" / 「n 件 / 全 m 件」 under the field; with none, "No requests match" and
    **Clear search**.
  - Keys: `/` goes to the field (not while typing elsewhere or with a box open). ↑ ↓ move through
    the rows and Enter chooses one, keeping the focus in the field. Esc clears, and on an empty
    field leaves it. The field's keys are its own: ← → move the caret.
  - While an IME converts, nothing narrows. The committed text does (`compositionend`).
  - The chosen request stays chosen when the search hides it, and the board keeps showing it.
  - The search is not saved: a reopened board starts with an empty field.
- **No debounce.** Every key narrows at once. Measured below.
- To stay within a frame:
  - Every text is folded once, ahead of time. The search's view of each request is made when the
    board is idle after a read that changed something, or when the field gets focus, and it is
    kept until the Items, the requests or the edits change. Folded texts are also cached by text.
    A key only folds the query and runs `includes` over the folded texts.
  - The list is drawn a screenful at a time (30 rows). More rows are drawn when it scrolls near its
    end, or when ↓ reaches the last drawn row. A redraw (a fresh read, a click, an edit) draws as
    many rows as were drawn, so the list never shrinks under the owner; a new search starts over
    from one screenful. The rows that must be there are always drawn: the focused row, the row ↑ ↓
    point at, a name being edited, Archived's requests when it is opened, and the chosen request
    when the list scrolls to it (not while searching).
  - Telling whether a fresh read changed the list compares a key made once per read, not per key.

### Measurements

A made-up board of 500 requests (one chat each) with 10 Items each, 5,000 Items in all. Titles mix
English and Japanese words (`editor/synthetic.ts`). Each key is timed from the input event to the
list redrawn, with style and layout forced. Each word is typed one key at a time, 5 times (a
one-letter word 25 times: it is the first key of every search).

In Orca (Chromium, the board's own frame), with `examples/bench-search.itemsboard` (All chosen) and
`examples/bench-search-deep.itemsboard` (request 400 of 500 chosen, so the list was first drawn
down to it). The times are drawn on the board:

| Typed | Keys | All chosen: median / p95 / max | Request 400 chosen: median / p95 / max |
| --- | --- | --- | --- |
| `release notes` | 65 | 6.2 / 7.7 / 10.4 ms | 6.0 / 8.3 / 9.3 ms |
| `e` (matches almost every request) | 25 | 7.5 / 10.1 / 17.5 ms | 7.5 / 8.4 / 8.6 ms |
| `a` | 25 | 6.3 / 7.3 / 15.0 ms | 6.6 / 7.3 / 8.1 ms |
| `#4321` | 25 | 3.3 / 7.1 / 8.0 ms | 3.5 / 12.9 / 15.2 ms |
| `データ移行` | 25 | 5.4 / 8.2 / 13.4 ms | 5.7 / 8.1 / 8.1 ms |

- Making the search's view of all 500 requests: 5.5–7.3 ms, once per change, before the first key.
  The first key after it: about 10 ms.
- Matching alone (all 500 requests): under 0.3 ms per key in Node.
- Before drawing in chunks, every match was a row drawn on each key. In happy-dom that took a
  median of 72 ms per key for `release notes` (p95 158 ms). In Orca it was slow enough that the
  measuring page did not paint within the screenshot's wait. Drawing 30 rows brought happy-dom to
  a median of 15.5 ms; happy-dom is a slow DOM, so this is an upper bound
  (`ITEMS_BENCH=1 npm test` runs `editor/search.bench.test.ts`).
- Folding each text whole (NFKC once) instead of piece by piece cut making the search's view from
  about 34 ms to 7 ms. Highlighting still folds piece by piece, only for the rows drawn, to map a
  match back to the text as shown.
- A chosen request far down first made every key (and clearing the search) draw down to it. The
  list now draws down to it only when it scrolls to it (first draw, a new choice); the second
  column above is that fixed build.

Every p95 is within a frame, and one key in 25 at most went past 16 ms (17.5 ms, a one-letter
query). A delay would only make the list feel slower. If boards grow far past this size, the next
step is still not a delay but reusing drawn rows; a 100–150 ms debounce stays the last resort.

## Consequences

- The list follows every key, and Japanese input narrows only once a word is committed.
- A long list scrolls in steps: rows below the first 30 appear as it scrolls. The count above
  always covers every match.
- The search sees Item numbers and every Item title, also of Items the row doesn't list. Such a
  match shows its Item as an extra line, so a row is never in the results without saying why.
- The demo gets a `"many": true` option (about twenty requests) for the search's screenshots, and
  `"search"` types into the field. `"synthetic"` and `"measure"` exist only to repeat the
  measurements above.

## Alternatives considered

- **A debounce (100–150 ms).** Not needed by the measurements; it would add that delay to every
  narrowing.
- **A search button or Enter to search.** Not what the owner asked for.
- **Fuzzy matching.** Harder to explain why a row matched; words that must all be found are
  predictable and fast.
- **Hiding non-matching rows instead of drawing the matches.** Keeps every row in the page, so the
  cost of a long list stays; drawing in chunks bounds the work per key.
