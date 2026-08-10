import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimePwaPrompts } from '@/pwa/RuntimePwaPrompts'

vi.mock('@/pwa/PwaPrompts', () => ({ PwaPrompts: () => <div data-testid="pwa-prompts" /> }))

afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__') })

describe('runtime-specific PWA behavior', () => {
  it('does not mount service-worker prompts inside Tauri', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const { queryByTestId } = render(<RuntimePwaPrompts />)
    expect(queryByTestId('pwa-prompts')).toBeNull()
  })

  it('keeps PWA prompts available in the browser runtime', () => {
    const { getByTestId } = render(<RuntimePwaPrompts />)
    expect(getByTestId('pwa-prompts')).toBeTruthy()
  })
})

