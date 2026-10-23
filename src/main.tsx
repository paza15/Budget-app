import '@/styles/tokens.css'
import '@/styles/global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { installNavigation } from '@/app/nav'
import { installPrivacyCover } from '@/app/privacyCover'
import { registerServiceWorker } from '@/features/pwa/sw'
import { initStore } from '@/store/persistence'
import { initSecurity } from '@/store/securityStore'

// Start-up work runs once, here, before the first render (docs/SPEC.md §5.6, §5.10). No component
// starts it, so StrictMode's double effects cannot repeat it. initStore and initSecurity never
// reject; their progress shows in the stores' status. installNavigation connects the nav store to
// browser history (§5.5).
void initStore()
void initSecurity()
installPrivacyCover()
installNavigation()
if (import.meta.env.PROD) {
  // Updates are a bonus: a failure to register must never keep the app from starting.
  try {
    registerServiceWorker()
  } catch (error) {
    console.error(error)
  }
}

const container = document.getElementById('root')
if (!container) throw new Error('index.html has no #root element.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
