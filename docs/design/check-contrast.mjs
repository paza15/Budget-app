// Usage: node docs/design/check-contrast.mjs [path/to/tokens.css]
// WCAG contrast of every text token and every accent against the surfaces it sits on, in both
// themes, read straight from src/styles/tokens.css. Translucent fills are composited over the
// surface they sit on. Exit 1 on any failure.
import fs from 'node:fs'
// Colour helpers (sRGB relative luminance, WCAG contrast, alpha compositing).
const hex2rgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) }
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const relLum = (h) => { const [r, g, b] = hex2rgb(h).map(s2l); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
function over(rgba, bg) {
  const m = /rgba?\(([^)]+)\)/.exec(rgba); if (!m) return rgba
  const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x))
  const [R, G, B] = hex2rgb(bg).map((x) => x * 255)
  return '#' + [[r, R], [g, G], [b, B]].map(([f, k]) => Math.round(f * a + k * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase()
}
const css = fs.readFileSync(process.argv[2] ?? new URL('../../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function block(selector, from = 0) {
  const i = css.indexOf(selector + ' {', from)
  if (i < 0) throw new Error('missing block ' + selector)
  let depth = 0, j = css.indexOf('{', i)
  const start = j
  for (; j < css.length; j++) { if (css[j] === '{') depth++; if (css[j] === '}' && --depth === 0) break }
  return Object.fromEntries([...css.slice(start + 1, j).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const base = block(':root')
const dark = block(':root[data-theme="dark"]')
const darkMedia = block(':root:not([data-theme="light"])', css.indexOf('@media (prefers-color-scheme: dark)'))
const diff = [...new Set([...Object.keys(dark), ...Object.keys(darkMedia)])].filter((k) => dark[k] !== darkMedia[k])
const ACCENTS = ['navy', 'royal', 'teal', 'bottle', 'burgundy', 'plum', 'cognac', 'graphite']
function resolve(vars, name, seen = new Set()) {
  const v = vars[name]
  if (v === undefined) throw new Error('undefined ' + name)
  const m = /^var\((--[\w-]+)\)$/.exec(v)
  if (m) { if (seen.has(m[1])) throw new Error('cycle ' + name); seen.add(m[1]); return resolve(vars, m[1], seen) }
  return v
}
const hex = (v) => /^#[0-9a-fA-F]{6}$/.test(v)
const fails = [], rows = []
// A "surface" spec is either a token or [fillToken, overToken] for a translucent fill on a surface.
const sv = (vars, s) => (Array.isArray(s) ? over(resolve(vars, s[0]), resolve(vars, s[1])) : resolve(vars, s))
const sn = (s) => (Array.isArray(s) ? `${s[0].slice(2)}/${s[1].slice(2)}` : s.slice(2))
function check(theme, accent, vars, fg, surfaces, min) {
  const f = Array.isArray(fg) ? sv(vars, fg) : resolve(vars, fg)
  for (const s of surfaces) {
    const b = sv(vars, s)
    if (!hex(f) || !hex(b)) { fails.push(`${theme}/${accent}: ${fg} on ${sn(s)} not hex (${f}, ${b})`); continue }
    const c = contrast(f, b)
    rows.push({ theme, accent, fg: Array.isArray(fg) ? sn(fg) : fg, bg: sn(s), c, min })
    if (c < min) fails.push(`${theme}/${accent}: ${Array.isArray(fg) ? sn(fg) : fg} ${f} on ${sn(s)} ${b} = ${c.toFixed(2)} < ${min}`)
  }
}
const PAPER = ['--bg', '--surface', '--surface-raised', '--surface-sheet', '--glass-solid']
const FILLS = [['--surface-2', '--bg'], ['--surface-2', '--surface'], ['--surface-2', '--surface-sheet'], ['--surface-2', '--surface-raised']]
for (const theme of ['light', 'dark']) {
  for (const accent of ACCENTS) {
    const vars = { ...base, ...(accent === 'navy' ? {} : block(`:root[data-accent="${accent}"]`)), ...(theme === 'dark' ? dark : {}) }
    if (accent === 'navy') {
      check(theme, '-', vars, '--ink', [...PAPER, ...FILLS, '--warning-soft', '--critical-soft', ['--accent-soft', '--surface']], 4.5)
      check(theme, '-', vars, '--ink-2', [...PAPER, ...FILLS, '--warning-soft', '--critical-soft', ['--accent-soft', '--surface']], 4.5)
      check(theme, '-', vars, '--ink-3', PAPER, 4.5)
      check(theme, '-', vars, '--ink-inverse', ['--ink'], 4.5)
      check(theme, '-', vars, '--ink', ['--thumb'], 4.5)
      check(theme, '-', vars, '--good-ink', PAPER, 4.5)
      check(theme, '-', vars, '--warning-ink', [...PAPER, '--warning-soft'], 4.5)
      check(theme, '-', vars, '--critical-ink', [...PAPER, '--critical-soft'], 4.5)
      check(theme, '-', vars, '--toast-ink', ['--toast-bg'], 4.5)
      check(theme, '-', vars, '--toast-action', ['--toast-bg'], 4.5)
      // Marks: >= 3:1 on the surfaces they are drawn on.
      check(theme, '-', vars, '--mark', ['--bg', '--surface', '--surface-raised', '--surface-sheet'], 3)
      check(theme, '-', vars, '--brass', ['--bg', '--surface'], 3)
      for (const m of ['--good', '--warning', '--warning-mark', '--critical']) check(theme, '-', vars, m, ['--bg', '--surface', '--surface-raised', '--surface-sheet'], 3)
      check(theme, '-', vars, '--cat-other', ['--surface'], 3)
      check(theme, '-', vars, '--ink', [['--track', '--surface'], ['--track', '--bg']], 3) // pace and meter fill against their track
      // Control fills differ from their container by 1.1:1 (SPEC §6); otherwise they carry a hairline.
      for (const s of ['--bg', '--surface', '--surface-sheet']) {
        const c = contrast(over(resolve(vars, '--surface-2'), resolve(vars, s)), resolve(vars, s))
        rows.push({ theme, accent: '-', fg: 'surface-2', bg: s.slice(2), c, min: 1.1 })
        if (c < 1.1) fails.push(`${theme}: --surface-2 on ${s} = ${c.toFixed(3)} < 1.1 (needs a hairline)`)
      }
    }
    check(theme, accent, vars, '--on-accent', ['--accent'], 4.5) // also the switch knob when on
    check(theme, accent, vars, '--accent-ink', [...PAPER, ...FILLS, ['--accent-soft', '--surface'], ['--accent-soft', '--surface-raised']], 4.5)
    check(theme, accent, vars, '--accent', ['--bg', '--surface', '--surface-sheet', '--glass-solid'], 3) // filled controls as UI components
    check(theme, accent, vars, `--accent-${accent}`, ['--surface', '--surface-raised'], 3) // picker swatch
  }
}
const by = {}
for (const r of rows) { const k = `${r.theme} ${r.accent} ${r.fg}`; (by[k] ??= []).push(`${r.bg} ${r.c.toFixed(2)}`) }
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(34), v.join('  '))
console.log(`\n${rows.length} pairs checked.`, diff.length ? `Dark blocks differ: ${diff.join(', ')}` : 'Both dark blocks are identical.')
if (diff.length) fails.push('dark blocks differ')
if (fails.length) { console.log('\nFAIL\n' + fails.join('\n')); process.exit(1) }
console.log('All pairs pass.')
