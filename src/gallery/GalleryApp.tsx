import { ChartsGallery } from './ChartsGallery'
import { FoundationsGallery } from './FoundationsGallery'
import { OverlaysGallery } from './OverlaysGallery'

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
document.documentElement.dataset.accent = params.get('accent') ?? 'navy'
const section = params.get('section')

/** Renders one gallery section, or all of them, for visual checks of the UI kit. */
export function GalleryApp() {
  return (
    <main style={{ display: 'grid', gap: 'var(--space-8, 32px)', padding: 'var(--space-4, 16px)' }}>
      {(section === null || section === 'foundations') && <FoundationsGallery />}
      {(section === null || section === 'overlays') && <OverlaysGallery />}
      {(section === null || section === 'charts') && <ChartsGallery />}
    </main>
  )
}
