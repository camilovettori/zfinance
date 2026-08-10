import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/app/App'
import { LocalStatus } from '@/components/feedback/LocalStatus'
import { RuntimePwaPrompts } from '@/pwa/RuntimePwaPrompts'
import './style.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
    <LocalStatus />
    <RuntimePwaPrompts />
  </React.StrictMode>,
)
