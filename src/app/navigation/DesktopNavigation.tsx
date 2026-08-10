import { SECTION_ITEMS, type SectionKey } from './sections'

export function DesktopNavigation({ activeSection, onNavigate }: { activeSection: SectionKey; onNavigate: (section: SectionKey) => void }) {
  return <nav className="app-nav" aria-label="Main navigation">
    {SECTION_ITEMS.map((item) => {
      const Icon = item.icon
      return <button
        key={item.key}
        className="nav-item"
        data-active={activeSection === item.key}
        aria-current={activeSection === item.key ? 'page' : undefined}
        onClick={() => onNavigate(item.key)}
      >
        <Icon size={19} aria-hidden="true" />{item.label}
      </button>
    })}
  </nav>
}

