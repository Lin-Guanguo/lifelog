import { ref, watchEffect } from 'vue'
import zhCN from './zh-CN'
import en from './en'

export type MessageKey = keyof typeof zhCN
export type Messages = Record<MessageKey, string>

const catalogs: Record<string, Messages> = { 'zh-CN': zhCN, en }
export const LOCALES = Object.keys(catalogs)
// 'system' follows the device language.
export type LocalePreference = 'system' | (typeof LOCALES)[number]

export const localePreference = ref<LocalePreference>('system')
export const locale = ref('zh-CN')

export function resolveLocale(preference: LocalePreference, languages: readonly string[]): string {
  if (preference !== 'system' && catalogs[preference]) return preference
  for (const lang of languages) {
    if (catalogs[lang]) return lang
    const base = lang.split('-')[0]
    if (base === 'zh') return 'zh-CN'
    if (catalogs[base]) return base
  }
  return 'zh-CN'
}

watchEffect(() => {
  locale.value = resolveLocale(localePreference.value, typeof navigator === 'undefined' ? [] : navigator.languages)
  if (typeof document !== 'undefined') document.documentElement.lang = locale.value
})

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const template = catalogs[locale.value][key] ?? zhCN[key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

export function localeName(code: string): string {
  return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}
