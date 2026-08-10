import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const INSTALL_DISMISSED_KEY = 'homecoin:pwa-install-dismissed-at'
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))

export function PwaPrompts() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(() => {
    if (isStandalone()) return false
    const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY) ?? 0)
    return Date.now() - dismissedAt >= DISMISS_FOR_MS && /iphone|ipad|ipod/i.test(navigator.userAgent)
  })
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  useEffect(() => {
    if (isStandalone()) return
    const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY) ?? 0)
    if (Date.now() - dismissedAt < DISMISS_FOR_MS) return

    const onInstallAvailable = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onInstallAvailable)

    return () => window.removeEventListener('beforeinstallprompt', onInstallAvailable)
  }, [])

  const dismissInstall = () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()))
    setInstallEvent(null)
    setShowIosHelp(false)
  }

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  return <>
    {needRefresh ? <aside className="pwa-prompt print-hide" role="status" aria-live="polite">
      <div><strong>New version available</strong><span>Your current work stays local until you choose to update.</span></div>
      <button onClick={() => void updateServiceWorker(true)}>Update now</button>
      <button className="pwa-prompt-later" onClick={() => setNeedRefresh(false)}>Later</button>
    </aside> : null}

    {installEvent || showIosHelp ? <aside className="pwa-install print-hide" aria-label="Install HomeCoin">
      <div><strong>Install HomeCoin</strong><span>{showIosHelp ? 'In Safari, tap Share, then Add to Home Screen.' : 'Keep HomeCoin ready on this device, even offline.'}</span></div>
      {installEvent ? <button onClick={() => void install()}>Install</button> : null}
      <button className="pwa-prompt-later" onClick={dismissInstall}>Not now</button>
    </aside> : null}
  </>
}
