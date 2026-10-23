/**
 * Icons the UI uses (docs/DESIGN.md §8, docs/SPEC.md §5.8). scripts/build-icons.mjs reads this file,
 * together with every CATEGORY_ICONS key in src/domain/catalog.ts, and writes their path data to
 * generated.ts (`npm run build:icons`). Nothing here is drawn at runtime: Icon and CategoryIcon only
 * read generated.ts.
 */

/** Every icon name the UI draws. Icon accepts only these. */
export const UI_ICON_NAMES = [
  'home',
  'daily',
  'fixed',
  'wallet',
  'plus',
  'plus-circle',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'chevron-up',
  'chevron-updown',
  'check',
  'on-track',
  'warning',
  'critical',
  'close',
  'clear',
  'search',
  'eye',
  'eye-off',
  'lock',
  'face-id',
  'tap',
  'backspace',
  'calendar',
  'reload',
  'undo',
  'backup',
  'share',
  'download',
  'upload',
  'trash',
  'edit',
  'archive',
  'info',
  'more',
  'arrow-up',
  'arrow-down',
  'emoji',
  'people',
  'person',
  'owed',
  'repeat',
  'sparkle',
  'logo',
] as const

export type UiIconName = (typeof UI_ICON_NAMES)[number]

/** Phosphor weights the app draws with. */
export type IconWeight = 'regular' | 'fill' | 'light' | 'bold'

/**
 * Where an icon's path data comes from.
 * - `phosphor`: a file name in @phosphor-icons/core (e.g. 'caret-left'), extracted in each listed
 *   weight from assets/<weight>/<name>[-<weight>].svg. The first weight is the icon's default: Icon
 *   draws it when no weight is asked for, or when the asked weight was not extracted.
 * - `file`: a drawing of the app's own in this repository (one path, its own viewBox), drawn as the
 *   'regular' weight.
 */
export type UiIconSource =
  | { readonly phosphor: string; readonly weights: readonly [IconWeight, ...IconWeight[]] }
  | { readonly file: string }

/**
 * The source of every UI icon, with the weights DESIGN.md §8 uses: tabs regular, fill when active;
 * glass buttons regular; chevrons, steppers, the paid check and the add button bold; status icons
 * fill (check-circle regular); keypad backspace, Face ID and feature lines light.
 */
export const UI_ICON_SOURCES: { readonly [N in UiIconName]: UiIconSource } = {
  home: { phosphor: 'house-simple', weights: ['regular', 'fill'] },
  // light: the Daily empty state
  daily: { phosphor: 'receipt', weights: ['regular', 'fill', 'light'] },
  // light: onboarding
  fixed: { phosphor: 'calendar-check', weights: ['regular', 'fill', 'light'] },
  // regular and fill: the tab; regular: "Paid from wallet" subtitles; light: the Wallet empty state
  wallet: { phosphor: 'wallet', weights: ['regular', 'fill', 'light'] },
  plus: { phosphor: 'plus', weights: ['bold'] },
  'plus-circle': { phosphor: 'plus-circle', weights: ['regular'] },
  'chevron-left': { phosphor: 'caret-left', weights: ['bold'] },
  'chevron-right': { phosphor: 'caret-right', weights: ['bold'] },
  'chevron-down': { phosphor: 'caret-down', weights: ['bold'] },
  // The Wallet's "Done" header when it is open (DESIGN.md §9.26).
  'chevron-up': { phosphor: 'caret-up', weights: ['bold'] },
  'chevron-updown': { phosphor: 'caret-up-down', weights: ['regular'] },
  check: { phosphor: 'check', weights: ['bold'] },
  'on-track': { phosphor: 'check-circle', weights: ['regular'] },
  warning: { phosphor: 'warning', weights: ['fill'] },
  critical: { phosphor: 'warning-octagon', weights: ['fill'] },
  close: { phosphor: 'x', weights: ['bold'] },
  clear: { phosphor: 'x-circle', weights: ['fill'] },
  // light: the empty state of a search without results
  search: { phosphor: 'magnifying-glass', weights: ['regular', 'light'] },
  eye: { phosphor: 'eye', weights: ['regular'] },
  'eye-off': { phosphor: 'eye-slash', weights: ['regular'] },
  lock: { phosphor: 'lock-simple', weights: ['light'] },
  'face-id': { phosphor: 'scan-smiley', weights: ['light'] },
  tap: { phosphor: 'hand-tap', weights: ['light'] },
  backspace: { phosphor: 'backspace', weights: ['light'] },
  calendar: { phosphor: 'calendar-blank', weights: ['regular'] },
  reload: { phosphor: 'arrow-clockwise', weights: ['regular'] },
  undo: { phosphor: 'arrow-counter-clockwise', weights: ['regular'] },
  backup: { phosphor: 'cloud-arrow-up', weights: ['regular'] },
  // 'export' is Phosphor's box-and-arrow glyph, the share symbol iOS users know.
  share: { phosphor: 'export', weights: ['regular'] },
  download: { phosphor: 'download-simple', weights: ['regular'] },
  upload: { phosphor: 'upload-simple', weights: ['regular'] },
  trash: { phosphor: 'trash', weights: ['regular'] },
  edit: { phosphor: 'pencil-simple-line', weights: ['regular'] },
  archive: { phosphor: 'archive', weights: ['regular'] },
  info: { phosphor: 'info', weights: ['regular'] },
  more: { phosphor: 'dots-three', weights: ['bold'] },
  'arrow-up': { phosphor: 'arrow-up', weights: ['regular'] },
  'arrow-down': { phosphor: 'arrow-down', weights: ['regular'] },
  emoji: { phosphor: 'smiley', weights: ['regular'] },
  // Split bills and the settings button (docs/design/EXTRAS.md §5): the split line in rows (15),
  // the medallion without a name or emoji (16), the empty state of "Owed to you" (28).
  people: { phosphor: 'users', weights: ['regular'] },
  person: { phosphor: 'user', weights: ['light'] },
  owed: { phosphor: 'hand-coins', weights: ['light'] },
  // Kept from the first manifest for screens that may use them; DESIGN.md §8 does not list them.
  repeat: { phosphor: 'repeat', weights: ['regular'] },
  sparkle: { phosphor: 'sparkle', weights: ['regular', 'fill'] },
  // The app mark (loading screen, lock screen, privacy cover), drawn for this app (DESIGN.md §15).
  logo: { file: 'docs/design/mark.svg' },
}

/**
 * Weights extracted for every CATEGORY_ICONS key. Category glyphs are light everywhere: coins,
 * chips, quick adds and the picker (DESIGN.md §8). CategoryIcon draws the first one.
 */
export const CATEGORY_ICON_WEIGHTS: readonly [IconWeight, ...IconWeight[]] = ['light']

/** The engravings of DESIGN.md §3.1, extracted from these files into generated.ts. */
export const ENGRAVING_FILES = {
  rosette: 'docs/design/engraving-rosette.svg',
  seal: 'docs/design/engraving-seal.svg',
  medallion: 'docs/design/engraving-medallion.svg',
} as const

export type EngravingKind = keyof typeof ENGRAVING_FILES
