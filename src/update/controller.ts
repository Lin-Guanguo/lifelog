import { reactive } from 'vue'
import { platformTransport } from '../sync/http'
import { fetchLatestRelease, isNewer, type Release } from './github'

export const APP_VERSION = __APP_VERSION__

// Checks run only when the user taps "check for updates" in Settings.
export const update = reactive({
  open: false,
  status: 'checking' as 'checking' | 'latest' | 'available' | 'error',
  release: null as Release | null,
  error: '',
})

export async function checkForUpdate(): Promise<void> {
  Object.assign(update, { open: true, status: 'checking', release: null, error: '' })
  try {
    const release = await fetchLatestRelease(platformTransport())
    if (!update.open) return
    update.release = isNewer(release, APP_VERSION) ? release : null
    update.status = update.release ? 'available' : 'latest'
  } catch (error) {
    update.status = 'error'
    update.error = error instanceof Error ? error.message : String(error)
  }
}

export function closeUpdate(): void {
  update.open = false
}
