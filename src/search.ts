// Incremental search over the request list (ADR 0015). Every text is folded once (NFKC, lower
// case) and kept; a keystroke only folds the query and runs `includes` over the folded texts.
// Highlights map matches in the folded text back to the text as shown.

/** A base character with the marks that follow it (half-width kana sound marks count as marks),
 *  folded together so ｶﾞ becomes ガ just as NFKC does for the whole string. */
const CLUSTER = /[^\p{M}ﾞﾟ][\p{M}ﾞﾟ]*|[\p{M}ﾞﾟ]+/gsu
const ASCII = /^[\x00-\x7f]*$/

const folded = new Map<string, string>()
/** Texts kept folded at most; past it the cache starts over (titles repeat across reads). */
const FOLD_CACHE = 50_000

/** The text as it is matched: NFKC (full-width and half-width alike), lower case. */
export function fold(text: string): string {
  if (ASCII.test(text)) {
    return text.toLowerCase()
  }
  const hit = folded.get(text)
  if (hit !== undefined) {
    return hit
  }
  // The whole string at once for matching; highlights fold piece by piece (matchRanges) to map back.
  const out = text.normalize('NFKC').toLowerCase()
  if (folded.size >= FOLD_CACHE) {
    folded.clear()
  }
  folded.set(text, out)
  return out
}

/** The query's words: every one must be found (AND). Empty for a blank query. */
export function queryTerms(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

/** Where the terms are in `text` (as shown), merged and in order: [start, end) pairs. */
export function matchRanges(text: string, terms: readonly string[]): Array<[number, number]> {
  if (terms.length === 0 || text.length === 0) {
    return []
  }
  let norm: string
  let starts: number[]
  let ends: number[]
  if (ASCII.test(text)) {
    norm = text.toLowerCase()
    starts = []
    ends = []
    for (let i = 0; i < text.length; i++) {
      starts.push(i)
      ends.push(i + 1)
    }
  } else {
    norm = ''
    starts = []
    ends = []
    for (const match of text.matchAll(CLUSTER)) {
      const piece = match[0].normalize('NFKC').toLowerCase()
      const at = match.index ?? 0
      for (let i = 0; i < piece.length; i++) {
        starts.push(at)
        ends.push(at + match[0].length)
      }
      norm += piece
    }
  }
  const found: Array<[number, number]> = []
  for (const term of terms) {
    let from = norm.indexOf(term)
    while (from >= 0) {
      found.push([starts[from]!, ends[from + term.length - 1]!])
      from = norm.indexOf(term, from + 1)
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged: Array<[number, number]> = []
  for (const range of found) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([range[0], range[1]])
    }
  }
  return merged
}

/** One request as the search sees it. `shown` are the texts its row draws (name, the item titles
 *  listed under it, last ask, chat and bot names); `items` are all of its items, by number and title. */
export type SearchSource = {
  id: string
  shown: readonly string[]
  items: ReadonlyArray<{ number: number; title: string }>
}

export type SearchEntry = {
  id: string
  shown: string[]
  items: Array<{ number: number; title: string; text: string; folded: string }>
}

export function searchEntry(source: SearchSource): SearchEntry {
  return {
    id: source.id,
    shown: source.shown.map(fold),
    items: source.items.map((item) => {
      const text = `#${item.number} ${item.title}`
      return { number: item.number, title: item.title, text, folded: fold(text) }
    })
  }
}

export type SearchHit = {
  /** The item to add as a line, when some word is found only in an item the row doesn't show
   *  (its title isn't listed, or it matched by number): `#n title`. */
  extra: string | null
}

/** Whether every term is found in the request, and what the row must add to show why. */
export function matchEntry(entry: SearchEntry, terms: readonly string[]): SearchHit | null {
  const hidden: string[] = []
  for (const term of terms) {
    if (entry.shown.some((text) => text.includes(term))) {
      continue
    }
    if (!entry.items.some((item) => item.folded.includes(term))) {
      return null
    }
    hidden.push(term)
  }
  if (hidden.length === 0) {
    return { extra: null }
  }
  // The item that holds the most of the words the row doesn't show.
  let best: SearchEntry['items'][number] | null = null
  let bestCount = 0
  for (const item of entry.items) {
    let count = 0
    for (const term of hidden) {
      if (item.folded.includes(term)) {
        count++
      }
    }
    if (count > bestCount) {
      best = item
      bestCount = count
    }
  }
  return { extra: best ? best.text : null }
}
