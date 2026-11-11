import { ref } from 'vue'
import type { LogRecord, Records } from './data/records'

let records: Records
export const retentionHours = ref(7 * 24) // 0 = never clear

export function setRecords(r: Records): void {
  records = r
}

export function db(): Records {
  return records
}

// Set anew whenever the log changes (an entry added, edited, deleted, restored, or merged by sync): views holding rows
// (the main list's window, search results) read them again. `show` says what the main list shows then: by default
// the same entries; after sending, the newest (written now) or the new entry located (written at an earlier time).
export type Show = 'latest' | { locate: number }
export const logVersion = ref<{ seq: number; show?: Show }>({ seq: 0 })

export function logChanged(show?: Show): void {
  logVersion.value = { seq: logVersion.value.seq + 1, show }
}

export function sent(entryId: number, earlier: boolean): void {
  logChanged(earlier ? { locate: entryId } : 'latest')
}

export type Screen =
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'trash' }
  | { name: 'edit'; record: LogRecord } // the entry's text when editing started
  | { name: 'compose' } // the draft in the layout editor

// Screens stacked over the always-mounted main log.
export const screens = ref<Screen[]>([])

export function openScreen(screen: Screen): void {
  screens.value.push(screen)
}

export function closeScreen(): void {
  screens.value.pop()
}

// "Show this entry in the timeline" (⌖ in an entry's sheet): screens close, and the main list brings the entry into
// view and highlights it. `seq` makes locating the same entry twice a new request.
export const locateRequest = ref<{ entryId: number; seq: number }>()

export function locateEntry(entryId: number): void {
  screens.value = []
  locateRequest.value = { entryId, seq: (locateRequest.value?.seq ?? 0) + 1 }
}
