// Where request edits and the chosen request are kept: the plugin's own storage (storage:own), one
// value each. Versions before 0.2.0's storage move kept them in two settings; the first load moves
// them over and clears the settings.
import { ALL, compactId, parseEdits, serializeEdits, type RequestEdits } from './requests'

/** The part of Orca's storage and settings APIs this uses (the same in a worker and a frame). */
export type KeyValue = {
  get(key: string): Promise<unknown>
  set(key: string, value: never): Promise<unknown>
  delete?(key: string): Promise<unknown>
}

export const EDITS_KEY = 'requestEdits'
export const SELECTED_KEY = 'selectedRequest'

export type LoadedEdits = {
  edits: RequestEdits
  /** The saved text the edits came from (compact JSON), for the board's first-read tidy. */
  savedText: string
  selected: string
  /** Whether older settings were moved into storage on this load. */
  migrated: boolean
}

const asText = (value: unknown): string => (value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value))

/** Reads the edits and the choice; older settings move to storage, then are cleared. */
export async function loadEdits(storage: KeyValue, settings: KeyValue): Promise<LoadedEdits> {
  let stored = await storage.get(EDITS_KEY).catch(() => null)
  let selected = await storage.get(SELECTED_KEY).catch(() => null)
  let migrated = false
  const oldEdits = await settings.get(EDITS_KEY).catch(() => undefined)
  const oldSelected = await settings.get(SELECTED_KEY).catch(() => undefined)
  if (typeof oldEdits === 'string' && oldEdits.trim()) {
    if (stored === null || stored === undefined) {
      const text = serializeEdits(parseEdits(oldEdits))
      if (text) {
        await storage.set(EDITS_KEY, JSON.parse(text) as never)
        stored = JSON.parse(text)
      }
    }
    // Cleared only once storage holds them: a failed move leaves the settings as they were.
    await settings.set(EDITS_KEY, '' as never).catch(() => undefined)
    migrated = true
  }
  if (typeof oldSelected === 'string' && oldSelected.trim() && oldSelected !== ALL) {
    if (typeof selected !== 'string' || !selected) {
      selected = compactId(oldSelected)
      await storage.set(SELECTED_KEY, selected as never)
    }
    await settings.set(SELECTED_KEY, ALL as never).catch(() => undefined)
    migrated = true
  }
  const savedText = asText(stored)
  return {
    edits: parseEdits(savedText),
    savedText,
    selected: typeof selected === 'string' && selected ? compactId(selected) : ALL,
    migrated
  }
}

/** Saves the edits (removing the value when there are none). A refusal rejects. */
export function saveEdits(storage: KeyValue, edits: RequestEdits): Promise<unknown> {
  const text = serializeEdits(edits)
  if (!text) {
    return storage.delete ? storage.delete(EDITS_KEY) : storage.set(EDITS_KEY, null as never)
  }
  return storage.set(EDITS_KEY, JSON.parse(text) as never)
}

/** Reads the edits after a change from elsewhere (another board, or a reset). */
export async function readEdits(storage: KeyValue): Promise<RequestEdits> {
  return parseEdits(asText(await storage.get(EDITS_KEY).catch(() => null)))
}
