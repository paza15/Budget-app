/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages project sites live under /<repo>/; set BASE_PATH=/Budget-app/ when building for them.
const base = resolveBase(process.env.BASE_PATH)

/** --bg of the light theme (src/styles/tokens.css): the manifest's theme and splash colour. */
const LIGHT_BG = '#EDEEEA'

/** Diagnostics names the build with this, so a device can be matched to a deploy (src/env.d.ts). */
const BUILD_ID = buildId(process.env.GITHUB_SHA, new Date())

/** The Content-Security-Policy of production builds (docs/SPEC.md §7). */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    contentSecurityPolicy(),
    // docs/SPEC.md §7: installable, offline, updated on the user's say. src/features/pwa/sw.ts
    // registers the worker; a new version waits until "Reload" in the update banner.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The globs below already precache everything public/ contributes, icons included, so the
      // plugin must not add the manifest icons a second time.
      includeManifestIcons: false,
      manifest: {
        id: base,
        name: 'On a Budget',
        short_name: 'On a Budget',
        description: 'Your monthly budget, kept on this iPhone.',
        lang: 'en',
        dir: 'ltr',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: LIGHT_BG,
        theme_color: LIGHT_BG,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Its own artwork keeps the On switch and its frame inside the 80% safe zone, so masks never
          // cut it (docs/design/app-icon-maskable.svg, docs/DESIGN.md §15).
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The whole app, so it opens offline. The plugin adds manifest.webmanifest itself (with a
        // hash of its content); globbing it too would list it twice.
        globPatterns: [
          '**/*.{js,css,html,svg,png}',
          // Only the two Source Serif 4 cuts that src/styles/global.css declares (DESIGN.md §5.1).
          '**/source-serif-4-latin-opsz-normal-*.woff2',
          '**/source-serif-4-latin-ext-opsz-normal-*.woff2',
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    env: { TZ: 'Europe/Berlin' },
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] } },
      // A jsdom test renders whole screens and drives them with user-event; on a loaded 4-core laptop
      // the slowest take 5–6 s, past Vitest's 5 s default. 15 s still stops a real hang quickly.
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['src/**/*.test.tsx'], testTimeout: 15_000 },
      },
    ],
  },
})

/**
 * BASE_PATH (docs/SPEC.md §7, §10): the URL path the app is served from, '/' by default. Storage,
 * the passkey and the install are tied to it, so a value that is not a URL path stops the build
 * instead of shipping an app that cannot load its files.
 */
function resolveBase(value: string | undefined): string {
  const path = value?.trim() || '/'
  if (!/^\/(?:[\w.~-]+\/)*(?:[\w.~-]+)?$/.test(path)) {
    // Git Bash rewrites /Budget-app/ into C:/Program Files/Git/Budget-app/ for Windows programs.
    throw new Error(
      `BASE_PATH must be a URL path such as /Budget-app/, not "${path}". ` +
        'In Git Bash, prefix the command with MSYS_NO_PATHCONV=1.',
    )
  }
  return path.endsWith('/') ? path : `${path}/`
}

/**
 * The build's id: the first 7 characters of the commit when CI names one (GITHUB_SHA, set by the
 * GitHub Pages workflow), else when the build ran, in UTC: "2026-10-19 14:05". A clock time, not a
 * calendar date of the app's data, so toISOString is right here.
 */
function buildId(sha: string | undefined, now: Date): string {
  const commit = sha?.trim() ?? ''
  if (/^[0-9a-f]{7,40}$/i.test(commit)) return commit.slice(0, 7).toLowerCase()
  return now.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * Puts the Content-Security-Policy meta right after <meta charset>, ahead of every script and
 * style sheet it governs. Builds only: the dev server injects inline scripts (React Refresh) that
 * the policy forbids.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'on-a-budget:content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const charset = /<meta charset="[^"]*"\s*\/?>/i
        if (!charset.test(html)) throw new Error('index.html needs <meta charset> for the CSP to follow.')
        return html.replace(
          charset,
          (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        )
      },
    },
  }
}
