import { useEffect, useState } from 'react'
import { ChartNoAxesCombined, FileChartColumn, Menu, ReceiptText, CalendarRange } from 'lucide-react'
import { SECTION_ITEMS, type SectionKey } from './sections'

const primary: Array<{ key: SectionKey; label: string; icon: typeof CalendarRange }> = [
  { key: 'dashboard', label: 'Home', icon: ChartNoAxesCombined },
  { key: 'planner', label: 'Planner', icon: CalendarRange },
  { key: 'bills', label: 'Bills', icon: ReceiptText },
  { key: 'reports', label: 'Reports', icon: FileChartColumn },
]
const moreKeys: SectionKey[] = ['week', 'calendar', 'recurring', 'savings', 'settings']

export function MobileBottomNavigation({ activeSection, onNavigate }: { activeSection: SectionKey; onNavigate: (section: SectionKey) => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    if (!moreOpen) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMoreOpen(false)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [moreOpen])

  const navigate = (section: SectionKey) => {
    onNavigate(section)
    setMoreOpen(false)
  }

  return <>
    <nav className="mobile-nav print-hide" aria-label="Mobile navigation">
      {primary.map((item) => {
        const Icon = item.icon
        const active = activeSection === item.key
        return <button key={item.key} data-active={active} aria-current={active ? 'page' : undefined} onClick={() => navigate(item.key)} aria-label={item.label}>
          <Icon size={20} aria-hidden="true" /><span>{item.label}</span>
        </button>
      })}
      <button data-active={moreKeys.includes(activeSection)} aria-expanded={moreOpen} aria-haspopup="dialog" onClick={() => setMoreOpen((open) => !open)} aria-label="More sections">
        <Menu size={20} aria-hidden="true" /><span>More</span>
      </button>
    </nav>

    {moreOpen ? <div className="mobile-more-backdrop print-hide" role="presentation" onMouseDown={() => setMoreOpen(false)}>
      <section className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More sections" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>HomeCoin</small><h2>More</h2></div><button onClick={() => setMoreOpen(false)} aria-label="Close more sections">Close</button></header>
        <div>{SECTION_ITEMS.filter((item) => moreKeys.includes(item.key)).map((item) => {
          const Icon = item.icon
          return <button key={item.key} data-active={activeSection === item.key} onClick={() => navigate(item.key)}>
            <Icon size={20} aria-hidden="true" /><span>{item.label}</span>
          </button>
        })}</div>
      </section>
    </div> : null}
  </>
}

