import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { reactive } from 'vue'
import { NewerSchemaError } from '../data/schema'
import { photoFiles, setPhotoDownload } from '../media/photos'
import { t } from '../i18n'
import { db, reloadLive } from '../store'
import { platformTransport } from './http'
import { downloadPhoto, REMOTE_FILE, sync as syncOnce, type SyncState } from './sync'
import { createWebDav, WebDavError, type WebDavConfig } from './webdav'

export interface SyncSettings extends WebDavConfig {
  intervalMinutes: number // automatic sync interval; 0 = manual only
}

export const INTERVAL_PRESETS = [5, 60, 24 * 60] // anything else, including 0, is custom
const DEFAULT_INTERVAL_MINUTES = 24 * 60
const CHECK_EVERY_MS = 60_000

// Credentials live in app-private preferences, like the database itself.
const SETTINGS_KEY = 'syncSettings'
const STATE_KEY = 'syncState'
const DIRTY_KEY = 'syncDirty'

export const sync = reactive({
  settings: null as SyncSettings | null,
  state: {} as SyncState,
  dirty: false,
  status: 'idle' as 'idle' | 'syncing' | 'error',
  error: '',
})

let changes = 0
let lastAttemptAt = 0
let running: Promise<void> | undefined

const dav = (settings: WebDavConfig) => createWebDav(settings, platformTransport())

// Photo copies other devices uploaded are fetched from the server when first shown.
setPhotoDownload((file) => (sync.settings ? downloadPhoto(dav(sync.settings), file) : Promise.resolve(null)))

async function saveState() {
  await Preferences.set({ key: STATE_KEY, value: JSON.stringify(sync.state) })
  await Preferences.set({ key: DIRTY_KEY, value: sync.dirty ? '1' : '' })
}

async function saveSettingsOnly() {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(sync.settings) })
}

export async function loadSync(): Promise<void> {
  const read = async (key: string) => (await Preferences.get({ key })).value
  const settings = JSON.parse((await read(SETTINGS_KEY)) ?? 'null') as (SyncSettings & { auto?: boolean }) | null
  if (settings && settings.intervalMinutes === undefined) {
    settings.intervalMinutes = settings.auto === false ? 0 : DEFAULT_INTERVAL_MINUTES
    delete settings.auto
  }
  sync.settings = settings
  sync.state = JSON.parse((await read(STATE_KEY)) ?? '{}') as SyncState
  sync.dirty = (await read(DIRTY_KEY)) === '1'
}

export function remotePath(settings: WebDavConfig): string {
  return `${settings.directory.replace(/^\/+|\/+$/g, '')}/${REMOTE_FILE}`
}

function describe(error: unknown): string {
  if (error instanceof WebDavError) {
    return error.status === 401 || error.status === 403 ? t('sync.errorAuth') : t('sync.errorHttp', { status: error.status })
  }
  if (error instanceof NewerSchemaError) return t('sync.errorNewer')
  return t('sync.errorNetwork', { error: error instanceof Error ? error.message : String(error) })
}

export function validate(settings: WebDavConfig): string | null {
  let url: URL
  try {
    url = new URL(settings.url.trim())
  } catch {
    return t('sync.errorUrl')
  }
  // Android blocks unencrypted HTTP; Basic auth over plain HTTP would expose the password anyway.
  if (url.protocol !== 'https:' && Capacitor.getPlatform() !== 'web') return t('sync.errorHttps')
  if (!settings.directory.trim()) return t('sync.errorDirectory')
  return null
}

// Checks the connection and creates the folder before saving, then syncs once.
export async function saveSettings(settings: WebDavConfig): Promise<string | null> {
  const invalid = validate(settings)
  if (invalid) return invalid
  try {
    await dav(settings).ensureDirectory()
  } catch (error) {
    return describe(error)
  }
  const target = (s: WebDavConfig | null) => s && `${s.url.trim()}|${s.username}|${remotePath(s)}`
  if (target(settings) !== target(sync.settings)) sync.state = {}
  sync.settings = {
    ...settings,
    url: settings.url.trim(),
    directory: settings.directory.trim(),
    intervalMinutes: sync.settings?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
  }
  await saveSettingsOnly()
  await saveState()
  await syncNow()
  return null
}

export async function setSyncInterval(minutes: number): Promise<void> {
  if (!sync.settings) return
  sync.settings = { ...sync.settings, intervalMinutes: minutes }
  await saveSettingsOnly()
}

export async function removeSettings(): Promise<void> {
  sync.settings = null
  sync.state = {}
  sync.status = 'idle'
  sync.error = ''
  await Preferences.remove({ key: SETTINGS_KEY })
  await saveState()
}

// Single flight: concurrent callers share the running sync.
export function syncNow(): Promise<void> {
  running ??= (async () => {
    const settings = sync.settings
    if (!settings) return
    sync.status = 'syncing'
    sync.error = ''
    lastAttemptAt = Date.now()
    let changesAtUpload = changes
    try {
      const result = await syncOnce(dav(settings), db(), sync.state, sync.dirty, () => { changesAtUpload = changes },
        Date.now(), photoFiles)
      sync.state = result.state
      if (result.merged) await reloadLive()
      // Writes made after the snapshot was taken are still pending.
      if (result.uploaded) sync.dirty = changes !== changesAtUpload
      sync.status = 'idle'
    } catch (error) {
      sync.status = 'error'
      sync.error = describe(error)
    }
    await saveState()
  })().finally(() => { running = undefined })
  return running
}

// Due once the interval has passed since the last sync or failed attempt.
export function isDue(now: number, intervalMinutes: number, lastSyncAt = 0, lastAttempt = 0): boolean {
  return intervalMinutes > 0 && now - Math.max(lastSyncAt, lastAttempt) >= intervalMinutes * 60_000
}

// Called on start, on resume and periodically while the app runs.
export function autoSync(): void {
  if (sync.settings && isDue(Date.now(), sync.settings.intervalMinutes, sync.state.lastSyncAt, lastAttemptAt)) void syncNow()
}

export function startAutoSync(): () => void {
  autoSync()
  const timer = window.setInterval(autoSync, CHECK_EVERY_MS)
  return () => window.clearInterval(timer)
}

// Called after every committed local write.
export function noteChange(): void {
  changes++
  if (!sync.dirty) {
    sync.dirty = true
    void saveState()
  }
}
