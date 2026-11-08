import { Preferences } from '@capacitor/preferences'
import { LOCALES, type LocalePreference } from '../i18n'

export const RETENTION_OPTIONS = [1, 7, 30, 0] // 0 = never clear
const DEFAULT_RETENTION_DAYS = 7
const RETENTION_KEY = 'trashRetentionDays'
const LOCALE_KEY = 'locale'

export async function getRetentionDays(): Promise<number> {
  const { value } = await Preferences.get({ key: RETENTION_KEY })
  const days = Number(value)
  return value !== null && RETENTION_OPTIONS.includes(days) ? days : DEFAULT_RETENTION_DAYS
}

export async function setRetentionDays(days: number): Promise<void> {
  await Preferences.set({ key: RETENTION_KEY, value: String(days) })
}

export async function getLocalePreference(): Promise<LocalePreference> {
  const { value } = await Preferences.get({ key: LOCALE_KEY })
  return value && LOCALES.includes(value) ? value : 'system'
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  await Preferences.set({ key: LOCALE_KEY, value: preference })
}
