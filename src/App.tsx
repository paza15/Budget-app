import { AppBanners, BannerOutlet } from '@/app/AppBanners'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { LoadingScreen } from '@/app/LoadingScreen'
import { Shell } from '@/app/Shell'
import { StorageScreen } from '@/app/StorageScreen'
import { ThemeController } from '@/app/ThemeController'
import { LockScreen } from '@/features/lock/LockScreen'
import { useAutoLock } from '@/features/lock/useAutoLock'
import { Onboarding } from '@/features/onboarding/Onboarding'
import { useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { isBlockingPhase, useStorageStatus } from '@/store/persistence'
import { useSecurityStore } from '@/store/securityStore'
import { ConfirmHost, MoneyFormatContext, ToastHost } from '@/ui'
import styles from './App.module.css'

/**
 * The app's gates (docs/SPEC.md §5.6). Nothing that reads the data renders before data and lock
 * state have loaded. On a cold start with a PIN only the lock screen renders; later locks keep the
 * app mounted but inert under the lock screen. Storage problems replace the app, then onboarding or
 * the tabs. Banners render under the visible screen's header, or into the outlet at the top of
 * #app-root when there is no screen (onboarding).
 *
 * Toasts and dialogs sit outside #app-root, so onboarding and the storage screen can use them, but
 * nothing modal ever shows above the lock: --z-lock is above --z-confirm, --z-toast and --z-sheet,
 * and dialogs.ts makes the dialog and sheet layers inert while #app-root is hidden. The lock screen
 * therefore never uses toasts, dialogs or sheets; it shows its own views (Forgot PIN, erase).
 */
export function App() {
  const appReady = useAppStore((s) => s.status === 'ready')
  const sec = useSecurityStore((s) => s.status)
  const locked = useSecurityStore((s) => s.locked)
  const unlockedOnce = useSecurityStore((s) => s.unlockedOnce)
  const phase = useStorageStatus((s) => s.phase)
  const onboarded = useAppStore((s) => s.data.settings.onboarded)
  const money = useMoneyFormat()
  useAutoLock() // features/lock
  if (!appReady || sec === 'loading') return <LoadingScreen />
  return (
    <MoneyFormatContext value={money}>
      <ThemeController />
      {locked && !unlockedOnce ? null : (
        <ErrorBoundary level="app">
          <div id="app-root" className={styles.appRoot} inert={locked} aria-hidden={locked || undefined}>
            <BannerOutlet />
            <div className={styles.content}>
              {isBlockingPhase(phase) ? <StorageScreen /> : onboarded ? <Shell /> : <Onboarding />}
            </div>
          </div>
        </ErrorBoundary>
      )}
      {locked && <LockScreen />}
      <AppBanners />
      <ToastHost />
      <ConfirmHost />
    </MoneyFormatContext>
  )
}
