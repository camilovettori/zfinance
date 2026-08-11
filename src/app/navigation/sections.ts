import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  FileChartColumn,
  ReceiptText,
  Repeat2,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react'

export type SectionKey = 'dashboard' | 'planner' | 'week' | 'calendar' | 'recurring' | 'bills' | 'savings' | 'reports' | 'settings'

export const SECTION_ITEMS: Array<{ key: SectionKey; label: string; icon: LucideIcon }> = [
  { key: 'dashboard', label: 'Dashboard', icon: ChartNoAxesCombined },
  { key: 'planner', label: 'Planner', icon: CalendarRange },
  { key: 'week', label: 'This Week', icon: CalendarRange },
  { key: 'calendar', label: 'This Month', icon: CalendarDays },
  { key: 'recurring', label: 'Recurring', icon: Repeat2 },
  { key: 'bills', label: 'Bills', icon: ReceiptText },
  { key: 'savings', label: 'Savings', icon: Target },
  { key: 'reports', label: 'Reports', icon: FileChartColumn },
  { key: 'settings', label: 'Settings', icon: Settings },
]

const MAIN_NAVIGATION_KEYS: SectionKey[] = ['dashboard', 'planner', 'savings', 'reports', 'settings']

export const MAIN_NAVIGATION_ITEMS = SECTION_ITEMS.filter((item) => MAIN_NAVIGATION_KEYS.includes(item.key))
