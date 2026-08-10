import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const styles = readFileSync(path.join(process.cwd(), 'src', 'style.css'), 'utf8')

describe('mobile-first CSS safeguards', () => {
  it('reserves safe-area space for bottom navigation and content', () => {
    expect(styles).toContain('env(safe-area-inset-bottom)')
    expect(styles).toContain('--mobile-nav-height')
    expect(styles).toMatch(/\.app-frame[\s\S]*padding:[^;]*mobile-nav-height/)
  })

  it('prevents accidental horizontal body overflow and preserves zoom-friendly inputs', () => {
    expect(styles).toContain('overflow-x: clip')
    expect(styles).toMatch(/\.input, \.select, \.textarea \{ min-height:[^}]*font-size: 16px/)
  })

  it('supports reduced motion and touch-sized controls', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('--touch-target: 44px')
  })
})
