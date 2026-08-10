import { addDays, format, parseISO } from 'date-fns'

export function fromIsoDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toIsoDate(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

export function todayIso(referenceDate = new Date()) {
  return toIsoDate(referenceDate)
}

export function addIsoDays(isoDate: string, days: number) {
  return toIsoDate(addDays(fromIsoDate(isoDate), days))
}

export function isIsoBetween(isoDate: string, startIso: string, endIso: string) {
  return isoDate >= startIso && isoDate <= endIso
}

export function monthKey(isoDate: string) {
  return isoDate.slice(0, 7)
}

export function parseMaybeDate(value: string) {
  if (!value) {
    return null
  }

  return parseISO(value)
}
