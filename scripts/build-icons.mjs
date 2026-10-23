// Extracts the icon and engraving path data the UI draws into src/ui/icons/generated.ts
// (docs/SPEC.md §5.8, docs/DESIGN.md §3.1 and §8). Run with `npm run build:icons` after changing
// src/ui/icons/manifest.ts or CATEGORY_ICONS in src/domain/catalog.ts; the output is committed.
//
//   node scripts/build-icons.mjs           write generated.ts
//   node scripts/build-icons.mjs --check   exit 1 when generated.ts is out of date
//
// Sources: the UI icons listed in manifest.ts (Phosphor files in the weights listed there, or a
// drawing of the app's own), every CATEGORY_ICONS key in CATEGORY_ICON_WEIGHTS, and the three
// engravings of docs/design. Only path data is kept; nothing is drawn at runtime.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const phosphorAssets = join(root, 'node_modules', '@phosphor-icons', 'core', 'assets')
const outFile = join(root, 'src', 'ui', 'icons', 'generated.ts')
const check = process.argv.includes('--check')

/** Loads a TypeScript module of the app (with the @/ alias) through Vite's module runner. */
async function importApp(path) {
  const { module } = await runnerImport(path, {
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': join(root, 'src') } },
  })
  return module
}

/** The value of `name="…"` in one SVG tag, or null. */
function attr(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return match ? match[1] : null
}

/** The single <path> of a Phosphor SVG. Fails loudly when a file is missing or not one path. */
async function phosphorPath(name, weight) {
  const file = join(phosphorAssets, weight, weight === 'regular' ? `${name}.svg` : `${name}-${weight}.svg`)
  let svg
  try {
    svg = await readFile(file, 'utf8')
  } catch {
    throw new Error(`Phosphor has no "${name}" in ${weight} (${file}).`)
  }
  const svgTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  if (attr(svgTag, 'viewBox') !== '0 0 256 256') throw new Error(`${file}: unexpected viewBox.`)
  const shapes = svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse|g)\b[^>]*>/g) ?? []
  if (shapes.length !== 1 || !shapes[0].startsWith('<path')) {
    throw new Error(`${file}: expected exactly one <path>, found ${shapes.length} shapes.`)
  }
  const d = attr(shapes[0], 'd')
  if (!d) throw new Error(`${file}: the path has no data.`)
  return d
}

/** A drawing of the app's own: one path with its viewBox and fill rule. */
async function drawing(relativeFile) {
  const file = join(root, relativeFile)
  const svg = await readFile(file, 'utf8')
  const svgTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  const viewBox = attr(svgTag, 'viewBox')
  const paths = svg.match(/<path\b[^>]*>/g) ?? []
  if (!viewBox || paths.length !== 1) throw new Error(`${file}: expected a viewBox and exactly one <path>.`)
  const d = attr(paths[0], 'd')
  if (!d) throw new Error(`${file}: the path has no data.`)
  const fillRule = attr(paths[0], 'fill-rule') ?? attr(svgTag, 'fill-rule')
  return { viewBox, d, fillRule }
}

/** An engraving: <path id d> definitions in <defs>, drawn by <use href="#id" transform="rotate(a)">. */
async function engraving(relativeFile) {
  const file = join(root, relativeFile)
  const svg = await readFile(file, 'utf8')
  const svgTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  const viewBox = attr(svgTag, 'viewBox')
  const strokeWidth = Number(attr(svgTag, 'stroke-width'))
  if (!viewBox || !Number.isFinite(strokeWidth)) throw new Error(`${file}: expected viewBox and stroke-width.`)
  const paths = (svg.match(/<path\b[^>]*>/g) ?? []).map((tag) => {
    const id = attr(tag, 'id')
    const d = attr(tag, 'd')
    if (!id || !d) throw new Error(`${file}: every path needs an id and data.`)
    return { id, d }
  })
  const uses = (svg.match(/<use\b[^>]*>/g) ?? []).map((tag) => {
    const href = attr(tag, 'href') ?? attr(tag, 'xlink:href')
    const id = href?.startsWith('#') ? href.slice(1) : null
    if (!id || !paths.some((p) => p.id === id)) throw new Error(`${file}: <use> points to an unknown path.`)
    const transform = attr(tag, 'transform')
    const rotate = transform === null ? 0 : Number(/^rotate\(([-\d.]+)\)$/.exec(transform)?.[1])
    if (!Number.isFinite(rotate)) throw new Error(`${file}: only rotate() transforms are supported.`)
    return { id, rotate }
  })
  if (paths.length === 0 || uses.length === 0) throw new Error(`${file}: no paths or uses.`)
  return { viewBox, strokeWidth, paths, uses }
}

const manifest = await importApp('/src/ui/icons/manifest.ts')
const catalog = await importApp('/src/domain/catalog.ts')

const uiIcons = []
for (const name of manifest.UI_ICON_NAMES) {
  const source = manifest.UI_ICON_SOURCES[name]
  if (!source) throw new Error(`manifest.ts: "${name}" has no source.`)
  if ('file' in source) {
    const { viewBox, d, fillRule } = await drawing(source.file)
    uiIcons.push({ name, viewBox, weight: 'regular', paths: { regular: d }, fillRule })
  } else {
    const paths = {}
    for (const weight of source.weights) paths[weight] = await phosphorPath(source.phosphor, weight)
    uiIcons.push({ name, viewBox: '0 0 256 256', weight: source.weights[0], paths, fillRule: null })
  }
}

const categoryIcons = []
const seen = new Set()
for (const { key } of catalog.CATEGORY_ICONS) {
  if (seen.has(key)) throw new Error(`catalog.ts: CATEGORY_ICONS lists "${key}" twice.`)
  seen.add(key)
  const paths = {}
  for (const weight of manifest.CATEGORY_ICON_WEIGHTS) paths[weight] = await phosphorPath(key, weight)
  categoryIcons.push({ key, paths })
}

const engravings = []
for (const [kind, file] of Object.entries(manifest.ENGRAVING_FILES)) engravings.push({ kind, ...(await engraving(file)) })

// ── Output ──────────────────────────────────────────────────────────────────────────────────
const q = (s) => JSON.stringify(s)
const key = (s) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : q(s))
const weightsOf = (paths) =>
  Object.entries(paths)
    .map(([weight, d]) => `${weight}: ${q(d)}`)
    .join(', ')

const lines = [
  '// Generated by scripts/build-icons.mjs from @phosphor-icons/core (MIT) and docs/design/*.svg.',
  '// Do not edit by hand: run `npm run build:icons` after changing src/ui/icons/manifest.ts or',
  '// CATEGORY_ICONS in src/domain/catalog.ts.',
  '',
  "import type { EngravingKind, IconWeight, UiIconName } from '@/ui/icons/manifest'",
  '',
  '/** Path data of one icon in the weights extracted for it. */',
  'export type IconPaths = Readonly<Partial<Record<IconWeight, string>>>',
  '',
  'export interface IconGlyph {',
  "  /** viewBox of the path data: Phosphor's 256 × 256 grid, or a drawing's own. */",
  '  readonly viewBox: string',
  '  /** The weight drawn when none is asked for, or when the asked weight was not extracted. */',
  '  readonly weight: IconWeight',
  '  readonly paths: IconPaths',
  "  readonly fillRule?: 'evenodd' | 'nonzero'",
  '}',
  '',
  '/** Every UI icon of manifest.ts. */',
  'export const UI_ICONS: { readonly [N in UiIconName]: IconGlyph } = {',
  ...uiIcons.map(
    (icon) =>
      `  ${key(icon.name)}: { viewBox: ${q(icon.viewBox)}, weight: ${q(icon.weight)}, paths: { ${weightsOf(icon.paths)} }${
        icon.fillRule ? `, fillRule: ${q(icon.fillRule)}` : ''
      } },`,
  ),
  '}',
  '',
  "/** Every CATEGORY_ICONS key (Phosphor file names) on Phosphor's 256 × 256 grid, by weight. */",
  'export const CATEGORY_ICON_PATHS: Readonly<Record<string, IconPaths>> = {',
  ...categoryIcons.map((icon) => `  ${key(icon.key)}: { ${weightsOf(icon.paths)} },`),
  '}',
  '',
  '/** UI icons and category icons in one map (UI names win). Prefer Icon and CategoryIcon. */',
  'export const ICON_PATHS: Readonly<Record<string, IconPaths>> = {',
  '  ...CATEGORY_ICON_PATHS,',
  '  ...Object.fromEntries(Object.entries(UI_ICONS).map(([name, glyph]) => [name, glyph.paths])),',
  '}',
  '',
  '/** A guilloché engraving (DESIGN.md §3.1): closed curves drawn as rotated copies. */',
  'export interface EngravingData {',
  '  readonly viewBox: string',
  '  /** Stroke width in CSS px; the paths use vector-effect: non-scaling-stroke. */',
  '  readonly strokeWidth: number',
  '  readonly paths: readonly { readonly id: string; readonly d: string }[]',
  '  /** One copy per entry: the path with that id, rotated by `rotate` degrees about the origin. */',
  '  readonly uses: readonly { readonly id: string; readonly rotate: number }[]',
  '}',
  '',
  'export const ENGRAVINGS: { readonly [K in EngravingKind]: EngravingData } = {',
  ...engravings.map((e) =>
    [
      `  ${key(e.kind)}: {`,
      `    viewBox: ${q(e.viewBox)},`,
      `    strokeWidth: ${e.strokeWidth},`,
      `    paths: [`,
      ...e.paths.map((p) => `      { id: ${q(p.id)}, d: ${q(p.d)} },`),
      `    ],`,
      `    uses: [${e.uses.map((u) => `{ id: ${q(u.id)}, rotate: ${u.rotate} }`).join(', ')}],`,
      `  },`,
    ].join('\n'),
  ),
  '}',
  '',
]
const output = lines.join('\n')

if (check) {
  const current = await readFile(outFile, 'utf8').catch(() => '')
  if (current.replace(/\r\n/g, '\n') !== output) {
    console.error('src/ui/icons/generated.ts is out of date. Run `npm run build:icons`.')
    process.exit(1)
  }
  process.stdout.write('src/ui/icons/generated.ts is up to date.\n')
} else {
  await writeFile(outFile, output)
  const weights = uiIcons.reduce((n, icon) => n + Object.keys(icon.paths).length, 0)
  process.stdout.write(
    `Wrote src/ui/icons/generated.ts: ${uiIcons.length} UI icons (${weights} weights), ` +
      `${categoryIcons.length} category icons, ${engravings.length} engravings, ${(output.length / 1024).toFixed(1)} KB.\n`,
  )
}
