import { describe, expect, it } from 'vitest'
import zhCN from './zh-CN'
import en from './en'
import { locale, resolveLocale, t } from './index'

describe('i18n', () => {
  it('every locale has exactly the source keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
  })

  it('every translation keeps the same placeholders', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
      expect(names(en[key]), key).toEqual(names(zhCN[key]))
    }
  })

  it('resolves the system language with a Chinese fallback', () => {
    expect(resolveLocale('system', ['en-US'])).toBe('en')
    expect(resolveLocale('system', ['zh-TW'])).toBe('zh-CN')
    expect(resolveLocale('system', ['fr-FR'])).toBe('zh-CN')
    expect(resolveLocale('en', ['zh-CN'])).toBe('en')
  })

  it('fills placeholders', () => {
    locale.value = 'en'
    expect(t('main.selected', { n: 3 })).toBe('3 selected')
    locale.value = 'zh-CN'
    expect(t('main.selected', { n: 3 })).toBe('已选 3 条')
  })
})
