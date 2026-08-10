import { isTauriRuntime } from '@/persistence/runtime'
import { PwaPrompts } from './PwaPrompts'

export function RuntimePwaPrompts() {
  return isTauriRuntime() ? null : <PwaPrompts />
}

