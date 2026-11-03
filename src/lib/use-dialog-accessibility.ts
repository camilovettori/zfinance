import { useEffect, useRef, type RefObject } from 'react'

const dialogs: HTMLElement[] = []
let previousOverflow = ''

export function useDialogAccessibility(ref: RefObject<HTMLElement | null>, onClose: () => void, open = true) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    if (!dialogs.length) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    dialogs.push(dialog)
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, [hidden], input[type="hidden"]') && !element.closest('[hidden], [aria-hidden="true"]'))
    ;(focusable()[0] ?? dialog).focus({ preventScroll: true })
    const handleKey = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements.at(-1)
        if (!first) { event.preventDefault(); dialog.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      const index = dialogs.indexOf(dialog)
      if (index >= 0) dialogs.splice(index, 1)
      if (!dialogs.length) document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open, ref])
}
