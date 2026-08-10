import { format } from 'date-fns'

export function formatCurrency(
  amountCents: number,
  currency: string,
  locale: string,
  hidden = false,
) {
  if (hidden) {
    return '••••'
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amountCents / 100)
}

export function formatSignedCurrency(
  amountCents: number,
  currency: string,
  locale: string,
  hidden = false,
) {
  if (hidden) {
    return '••••'
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  })

  const value = formatter.format(Math.abs(amountCents) / 100)
  return amountCents >= 0 ? `+${value}` : `-${value}`
}

export function formatMoneyText(
  amountCents: number,
  currency: string,
  locale: string,
) {
  return formatCurrency(amountCents, currency, locale)
}

export function formatDateLabel(dateIso: string, locale: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function formatDateShort(dateIso: string, locale: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(year, month - 1, day))
}

export function formatMonthLabel(dateIso: string, locale: string) {
  const [year, month, day] = dateIso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

export function formatCalendarDay(date: Date) {
  return format(date, 'd')
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}
