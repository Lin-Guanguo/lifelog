import { Preferences } from '@capacitor/preferences'
import { LOCALES, type LocalePreference } from '../i18n'

// Trash retention in hours; 0 = never clear. Presets are shown as buttons, anything else is "custom".
export const RETENTION_PRESETS = [24, 7 * 24, 30 * 24]
const DEFAULT_RETENTION_HOURS = 7 * 24
const RETENTION_KEY = 'trashRetentionHours'
const LEGACY_RETENTION_DAYS_KEY = 'trashRetentionDays' // v0.1.x
const LOCALE_KEY = 'locale'

export async function getRetentionHours(): Promise<number> {
  const parse = (value: string | null) => (value !== null && Number(value) >= 0 ? Number(value) : null)
  const hours = parse((await Preferences.get({ key: RETENTION_KEY })).value)
  if (hours !== null) return hours
  const legacyDays = parse((await Preferences.get({ key: LEGACY_RETENTION_DAYS_KEY })).value)
  return legacyDays !== null ? legacyDays * 24 : DEFAULT_RETENTION_HOURS
}

export async function setRetentionHours(hours: number): Promise<void> {
  await Preferences.set({ key: RETENTION_KEY, value: String(hours) })
}

export async function getLocalePreference(): Promise<LocalePreference> {
  const { value } = await Preferences.get({ key: LOCALE_KEY })
  return value && LOCALES.includes(value) ? value : 'system'
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  await Preferences.set({ key: LOCALE_KEY, value: preference })
}
