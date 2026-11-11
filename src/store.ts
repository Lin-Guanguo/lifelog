import { ref } from 'vue'
import type { LogRecord, Records } from './data/records'

let records: Records
export const liveRecords = ref<LogRecord[]>([])
export const retentionHours = ref(7 * 24) // 0 = never clear

export function setRecords(r: Records): void {
  records = r
}

export function db(): Records {
  return records
}

export async function reloadLive(): Promise<void> {
  liveRecords.value = await records.listLive()
}

export type Screen =
  | { name: 'search' }
  | { name: 'settings' }
  | { name: 'trash' }
  | { name: 'edit'; entryId: number }
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
