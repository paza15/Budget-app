import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/tokens.css'
import '@/styles/global.css'
import { GalleryApp } from './GalleryApp'

// Dev-only component gallery (gallery.html). Not part of the production build, whose only entry is
// index.html. Query params: section=foundations|overlays|charts, theme=light|dark, accent=<key>.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>,
)
