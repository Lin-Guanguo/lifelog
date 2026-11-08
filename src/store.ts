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
  | { name: 'view'; entryId: string }
  | { name: 'edit'; entryId: string }

// Screens stacked over the always-mounted main log.
export const screens = ref<Screen[]>([])

export function openScreen(screen: Screen): void {
  screens.value.push(screen)
}

export function closeScreen(): void {
  screens.value.pop()
}
