import { useRef, useState } from 'react'
import { Delete, X } from 'lucide-react'
import { useDialogAccessibility } from '@/lib/use-dialog-accessibility'
import type { SimpleKind } from '@/domain/home'

type Props = {
  locale: string
  currency: string
  /** Date the entry lands on, ISO YYYY-MM-DD. */
  date: string
  initialKind?: SimpleKind
  onClose: () => void
  /** Receives integer cents, never a float. */
  onSubmit: (kind: SimpleKind, amountCents: number) => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

/** Amount first, on a keypad: the phone's only high-frequency write. */
export function MobileAddSheet({ locale, currency, date, initialKind = 'bill', onClose, onSubmit }: Props) {
  const [kind, setKind] = useState<SimpleKind>(initialKind)
  const [raw, setRaw] = useState('')
  const sheetRef = useRef<HTMLElement>(null)
  useDialogAccessibility(sheetRef, onClose)

  const [whole = '', decimal = ''] = raw.split('.')
  const amountCents = Number(whole || '0') * 100 + Number(decimal.padEnd(2, '0') || '0')
  const display = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 })
    .format(amountCents / 100)

  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'del') return setRaw((current) => current.slice(0, -1))
    if (key === '.' && raw.includes('.')) return
    const next = raw + key
    if (/^\d*\.?\d{0,2}$/.test(next) && next.replace('.', '').length <= 9) setRaw(next)
  }

  return <div className="mobile-add-backdrop print-hide" role="presentation" onMouseDown={onClose}>
    <section
      className="mobile-add-sheet"
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Add income or bill"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="mobile-sheet-grip" aria-hidden="true" />
      <header className="mobile-sheet-heading"><div><small>Quick entry</small><h2>Add a movement</h2></div><button onClick={onClose} aria-label="Close quick entry"><X size={20} aria-hidden="true" /></button></header>
      <div className="mobile-add-kind" role="tablist" aria-label="Entry type">
        <button role="tab" aria-selected={kind === 'bill'} onClick={() => setKind('bill')}>Bill</button>
        <button role="tab" aria-selected={kind === 'income'} onClick={() => setKind('income')}>Income</button>
      </div>

      <div className="mobile-add-amount" aria-live="polite">
        <small>Amount</small>
        <strong data-kind={kind}>{kind === 'income' ? '+' : '−'}{display}</strong>
      </div>

      <div className="mobile-add-keypad">
        {KEYS.map((key) => <button key={key} onClick={() => press(key)} aria-label={key === 'del' ? 'Delete last digit' : key}>
          {key === 'del' ? <Delete size={19} aria-hidden="true" /> : key}
        </button>)}
      </div>

      <footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="mobile-add-primary"
          disabled={amountCents <= 0}
          onClick={() => onSubmit(kind, amountCents)}
        >
          Continue
        </button>
      </footer>
      <small className="mobile-add-date">Lands on {new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))}</small>
    </section>
  </div>
}
