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

function unit(n: number, unit: 'minute' | 'hour' | 'day'): string {
  return new Intl.NumberFormat(locale.value, { style: 'unit', unit, unitDisplay: 'long' }).format(n)
}

// A configured duration: whole days when it divides evenly, otherwise hours.
export function formatHours(hours: number): string {
  return hours % 24 === 0 ? unit(hours / 24, 'day') : unit(hours, 'hour')
}

export function formatMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) return unit(minutes / (24 * 60), 'day')
  return minutes % 60 === 0 ? unit(minutes / 60, 'hour') : unit(minutes, 'minute')
}

// Time remaining, rounded up: days when at least a day is left, otherwise hours.
export function formatRemaining(ms: number): string {
  const hours = Math.ceil(ms / 3_600_000)
  return hours >= 24 ? unit(Math.ceil(hours / 24), 'day') : unit(hours, 'hour')
}
