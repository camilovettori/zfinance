import { useEffect, useState } from 'react'
import { getPersistenceStatus, subscribePersistenceStatus } from '@/services/storage'
import type { PersistenceStatus } from '@/persistence'
import { getSyncStatus, subscribeSyncStatus, type CloudSyncSnapshot } from '@/sync/status'

const labelFor = (status: PersistenceStatus, online: boolean) => {
  if (!online) return 'Offline · saved locally'
  if (status === 'saving') return 'Saving…'
  if (status === 'error') return 'Save failed'
  if (status === 'loading') return 'Loading local data…'
  return 'Saved locally'
}

export function LocalStatus() {
  const [status, setStatus] = useState(getPersistenceStatus())
  const [sync, setSync] = useState<CloudSyncSnapshot>(getSyncStatus())
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => subscribePersistenceStatus(setStatus), [])
  useEffect(() => subscribeSyncStatus(setSync), [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  useEffect(() => {
    const protectPendingSave = (event: BeforeUnloadEvent) => {
      if (status !== 'saving') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectPendingSave)
    return () => window.removeEventListener('beforeunload', protectPendingSave)
  }, [status])

  const cloudLabel = !online ? 'Offline' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : sync.message
  const label = sync.status === 'local-only' ? labelFor(status, online) : cloudLabel
  return <div className="local-status print-hide" data-status={!online ? 'offline' : sync.status === 'local-only' ? status : sync.status} role="status" aria-live="polite" title={sync.pending ? `${sync.pending} item(s) need attention` : undefined}>
    <span aria-hidden="true" />{label}
  </div>
}
