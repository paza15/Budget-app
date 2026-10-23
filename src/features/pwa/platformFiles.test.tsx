import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCENTS } from '@/domain/catalog'
import { LS_KEYS } from '@/domain/constants'

// The files outside src that make the app installable (docs/SPEC.md §7, docs/DESIGN.md §15):
// index.html, public/theme-init.js, the manifest and CSP in vite.config.ts, and the icons. Their
// colours are copies of tokens.css, so these tests keep them in step with it.

// Node built-ins come in through import(string): typing them would need @types/node in the app's
// type program, and that would leak Node's globals (setTimeout's return type…) into all of src.
const fs = (await import('node:fs' as string)) as {
  readFileSync(path: string): Uint8Array
  existsSync(path: string): boolean
}
const { fileURLToPath } = (await import('node:url' as string)) as { fileURLToPath(url: string): string }

/** The repository root as a file URL: this test sits in src/features/pwa. */
const REPO = import.meta.url.replace(/src\/features\/pwa\/[^/?#]*(?:[?#].*)?$/, '')
const repoFile = (path: string) => fileURLToPath(REPO + path)
const read = (path: string) => new TextDecoder().decode(fs.readFileSync(repoFile(path)))

const tokens = read('src/styles/tokens.css')
const LIGHT = /:root\s*\{([^}]*)\}/
const DARK = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/
function token(block: RegExp, name: string): string {
  const body = block.exec(tokens)?.[1] ?? ''
  const value = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(body)?.[1]
  if (!value) throw new Error(`tokens.css has no ${name} in ${block}`)
  return value.toUpperCase()
}
const LIGHT_BG = token(LIGHT, '--bg')
const DARK_BG = token(DARK, '--bg')

/** jsdom reports colours of inline styles as rgb(). */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

function themeColor(): string | null | undefined {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
}

/** Size and transparency of a PNG, from its IHDR chunk, its colour type and any tRNS chunk. */
function png(path: string): { width: number; height: number; alpha: boolean } {
  const bytes = fs.readFileSync(repoFile(path))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  expect(ascii(1, 4)).toBe('PNG')
  const chunks: string[] = []
  for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) chunks.push(ascii(at + 4, at + 8))
  const colorType = bytes[25]
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    alpha: colorType === 4 || colorType === 6 || chunks.includes('tRNS'),
  }
}

describe('index.html', () => {
  const doc = new DOMParser().parseFromString(read('index.html'), 'text/html')
  const head = doc.head
  const meta = (name: string) => head.querySelectorAll(`meta[name="${name}"]`)
  const href = (selector: string) => head.querySelector(selector)?.getAttribute('href')

  it('paints --bg in both schemes before anything else', () => {
    const style = head.firstElementChild
    expect(style?.tagName).toBe('STYLE')
    expect(style?.textContent?.replaceAll(/\s+/g, ' ').trim().toUpperCase()).toBe(
      `HTML{BACKGROUND:${LIGHT_BG}}@MEDIA (PREFERS-COLOR-SCHEME:DARK){HTML{BACKGROUND:${DARK_BG}}}`,
    )
  })

  it('has the iOS metas of SPEC §7', () => {
    expect(doc.documentElement.lang).toBe('en')
    expect(doc.title).toBe('On a Budget')
    expect(head.querySelector('meta[charset]')?.getAttribute('charset')?.toLowerCase()).toBe('utf-8')
    expect(meta('viewport')[0]?.getAttribute('content')).toBe(
      'width=device-width, initial-scale=1, viewport-fit=cover',
    )
    expect(meta('apple-mobile-web-app-capable')[0]?.getAttribute('content')).toBe('yes')
    expect(meta('mobile-web-app-capable')[0]?.getAttribute('content')).toBe('yes')
    expect(meta('apple-mobile-web-app-status-bar-style')[0]?.getAttribute('content')).toBe('default')
    expect(meta('apple-mobile-web-app-title')[0]?.getAttribute('content')).toBe('On a Budget')
    expect(meta('format-detection')[0]?.getAttribute('content')).toBe('telephone=no')
  })

  it('has one theme-color meta, light --bg until theme-init.js runs', () => {
    const themeColors = meta('theme-color')
    expect(themeColors).toHaveLength(1)
    expect(themeColors[0]?.getAttribute('content')?.toUpperCase()).toBe(LIGHT_BG)
    expect(themeColors[0]?.hasAttribute('media')).toBe(false)
  })

  it('loads theme-init.js as a blocking script after the theme-color meta it updates', () => {
    const script = head.querySelector('script[src$="theme-init.js"]')
    expect(script?.getAttribute('src')).toBe('/theme-init.js')
    expect(script?.hasAttribute('type') || script?.hasAttribute('async') || script?.hasAttribute('defer')).toBe(false)
    const following = meta('theme-color')[0]?.compareDocumentPosition(script ?? doc.body)
    expect((following ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no inline scripts, which the CSP forbids', () => {
    for (const script of doc.querySelectorAll('script')) {
      expect(script.getAttribute('src')).toBeTruthy()
      expect(script.textContent?.trim()).toBe('')
    }
  })

  it('links the icons in public/', () => {
    expect(href('link[rel="apple-touch-icon"]')).toBe('/apple-touch-icon.png')
    expect(href('link[rel="icon"][type="image/svg+xml"]')).toBe('/favicon.svg')
    expect(href('link[rel="icon"][type="image/png"][sizes="32x32"]')).toBe('/favicon-32.png')
    for (const link of head.querySelectorAll('link[href]')) {
      expect(fs.existsSync(repoFile(`public${link.getAttribute('href') ?? ''}`))).toBe(true)
    }
  })
})

describe('public/theme-init.js', () => {
  const source = read('public/theme-init.js')
  const root = document.documentElement
  let systemDark = false

  function reset(): void {
    localStorage.clear()
    document.head.innerHTML = ''
    root.removeAttribute('data-theme')
    root.removeAttribute('data-accent')
    root.removeAttribute('style')
  }

  function run(saved: { theme?: string; accent?: string } = {}): void {
    if (saved.theme !== undefined) localStorage.setItem(LS_KEYS.theme, saved.theme)
    if (saved.accent !== undefined) localStorage.setItem(LS_KEYS.accent, saved.accent)
    new Function(source)()
  }

  beforeEach(() => {
    reset()
    document.head.innerHTML = `<meta name="theme-color" content="${LIGHT_BG}">`
    systemDark = false
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ media: query, matches: query === '(prefers-color-scheme: dark)' && systemDark }) as MediaQueryList,
    )
  })

  afterEach(reset)

  it('uses the colours of tokens.css and the keys of LS_KEYS and ACCENTS', () => {
    expect(source).toContain(`LIGHT_BG = '${LIGHT_BG}'`)
    expect(source).toContain(`DARK_BG = '${DARK_BG}'`)
    expect(source).toContain(`'${LS_KEYS.theme}'`)
    expect(source).toContain(`'${LS_KEYS.accent}'`)
    expect(source).toContain(`[${ACCENTS.map((a) => `'${a.key}'`).join(', ')}]`)
  })

  it('follows the system when nothing is saved', () => {
    run()
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-accent')).toBe('navy')
    expect(root.style.backgroundColor).toBe(rgb(LIGHT_BG))
    expect(themeColor()).toBe(LIGHT_BG)
  })

  it('follows a dark system for "system"', () => {
    systemDark = true
    run({ theme: 'system', accent: 'teal' })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-accent')).toBe('teal')
    expect(root.style.backgroundColor).toBe(rgb(DARK_BG))
    expect(themeColor()).toBe(DARK_BG)
  })

  it('applies a saved dark theme on a light system', () => {
    run({ theme: 'dark', accent: 'burgundy' })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-accent')).toBe('burgundy')
    expect(root.style.backgroundColor).toBe(rgb(DARK_BG))
    expect(themeColor()).toBe(DARK_BG)
  })

  it('applies a saved light theme on a dark system', () => {
    systemDark = true
    run({ theme: 'light' })
    expect(root.getAttribute('data-theme')).toBe('light')
    expect(root.style.backgroundColor).toBe(rgb(LIGHT_BG))
    expect(themeColor()).toBe(LIGHT_BG)
  })

  it('ignores values it does not know', () => {
    run({ theme: 'sepia', accent: 'fern' })
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-accent')).toBe('navy')
  })

  it('falls back to the defaults when storage or media queries throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    vi.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new TypeError('matchMedia is not a function')
    })
    run()
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.getAttribute('data-accent')).toBe('navy')
    expect(root.style.backgroundColor).toBe(rgb(LIGHT_BG))
  })

  it('does not need a theme-color meta', () => {
    document.head.innerHTML = ''
    expect(() => run({ theme: 'dark' })).not.toThrow()
    expect(root.style.backgroundColor).toBe(rgb(DARK_BG))
  })
})

describe('vite.config.ts', () => {
  const config = read('vite.config.ts')

  it('gives the manifest the light --bg', () => {
    expect(config).toContain(`const LIGHT_BG = '${LIGHT_BG}'`)
    expect(config).toMatch(/background_color: LIGHT_BG/)
    expect(config).toMatch(/theme_color: LIGHT_BG/)
  })

  it('carries the CSP of SPEC §7', () => {
    const list = /CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]/.exec(config)?.[1] ?? ''
    const directives = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]).join('; ')
    expect(directives).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    )
  })
})

describe('icons', () => {
  it.each([
    ['public/apple-touch-icon.png', 180],
    ['public/pwa-192.png', 192],
    ['public/pwa-512.png', 512],
    ['public/pwa-maskable-512.png', 512],
    ['public/favicon-32.png', 32],
  ])('%s is an opaque %i px square', (path, size) => {
    expect(png(path)).toEqual({ width: size, height: size, alpha: false })
  })

  it('favicon.svg draws the mark in --ink, and in the dark --ink for dark mode', () => {
    const svg = read('public/favicon.svg')
    expect(svg).toContain(`fill="${token(LIGHT, '--ink')}"`)
    expect(svg).toContain(`@media (prefers-color-scheme: dark) { svg { fill: ${token(DARK, '--ink')}; } }`)
    expect(svg).not.toContain('currentColor')
  })
})
