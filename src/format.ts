import { locale, t } from './i18n'

const pad = (n: number) => String(n).padStart(2, '0')

export function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dateOf(ms: number): string {
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', weekday: 'short' }).format(ms)
}

export function dayLabel(ms: number, now = Date.now()): string {
  const key = dayKey(ms)
  if (key === dayKey(now)) return t('day.today', { date: dateOf(ms) })
  if (key === dayKey(now - 86_400_000)) return t('day.yesterday', { date: dateOf(ms) })
  return dateOf(ms)
}

export function groupByDay<T extends { logged_at: number }>(rows: T[]): { key: string; label: string; rows: T[] }[] {
  const groups: { key: string; label: string; rows: T[] }[] = []
  for (const row of rows) {
    const key = dayKey(row.logged_at)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(row.logged_at), rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}
