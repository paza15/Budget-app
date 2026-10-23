import { create } from 'zustand'
import { LS_KEYS, LS_PREFIX } from '@/domain/constants'
import { compareISO, formatDate, localDateOf } from '@/domain/dates'
import { createInitialData, CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { DataError, droppedCount, isRecord, normalizeAppData, ownValue, type NormalizeReport } from '@/domain/normalize'
import type { AppData, Settings } from '@/domain/types'
import { getData, useAppStore, type AppState } from '@/store/appStore'
import {
  ConflictError,
  dailySnapshotDate,
  dailySnapshotKey,
  getKv,
  isSnapshotKey,
  KEYS,
  migrationSnapshotKey,
  resetKv,
  SNAPSHOT_KEYS,
  storedRev,
  type StoredMeta,
} from '@/store/db'
import { resetSecurity } from '@/store/securityStore'
import { useUiStore } from '@/store/uiStore'

/**
 * Loading and saving the app data (docs/SPEC.md §5.4, persistence rules 1–10). Saves are queued
 * with queueMicrotask, at most one write in flight, always the newest data, guarded by a revision
 * so two windows never overwrite each other.
 *
 * Every save is one transaction (KvBackend.commit) that checks the stored revision and writes the
 * data and its meta together, plus anything that must land with it: the first save after a load
 * that dropped rows also writes the original to the quarantine, the first after a migration the
 * pre-migration copy, and the first on a new day the previous day's copy.
 */

/**
 * ok: loaded and saving. write-failed: saving fails but is retried. memory-only: the user chose to
 * continue without saving. read-failed, newer-version, damaged and conflict block the app.
 */
export type StoragePhase =
  | 'loading'
  | 'ok'
  | 'read-failed'
  | 'newer-version'
  | 'damaged'
  | 'write-failed'
  | 'conflict'
  | 'memory-only'

export interface StorageStatus {
  phase: StoragePhase
  /** What went wrong, written for the user; null when nothing did. */
  error: string | null
  /** Result of navigator.storage.persisted()/persist(), or null when unknown or unsupported. */
  persisted: boolean | null
  /** A write is in flight or pending. */
  saving: boolean
  /** Damaged rows dropped by the last load (the raw value was kept in quarantine). */
  droppedOnLoad: number
}

/** An automatic copy of the data kept on this device. */
export interface SnapshotInfo {
  key: string
  /** e.g. "End of Fri 17 Oct", "Before import", "Before restore" or "Before update". */
  label: string
  /** When the copied data was saved (daily copies) or the copy was taken (the others). */
  savedAt: number
  transactions: number
}

/** What the storage status says when something goes wrong (§3.10). */
export const STORAGE_MESSAGES = {
  readFailed: "The app couldn't open your data. Close it completely and open it again.",
  newerVersion: 'This data was saved by a newer version of the app. Reload to update.',
  writeFailed: "Couldn't save your last changes. Reload to reconnect storage.",
  outOfSpace: "Your iPhone is out of storage, so the app can't save. Free up space, then open the app again.",
  conflict: 'The app was changed in another window. Reload to see the latest version.',
  eraseFailed: "Couldn't erase the app's data. Close it completely and try again.",
} as const

export const useStorageStatus = create<StorageStatus>()(() => ({
  phase: 'loading',
  error: null,
  persisted: null,
  saving: false,
  droppedOnLoad: 0,
}))

/** read-failed, newer-version, damaged and conflict replace the app with StorageScreen. */
export function isBlockingPhase(p: StoragePhase): boolean {
  return p === 'read-failed' || p === 'newer-version' || p === 'damaged' || p === 'conflict'
}

/** Windows of the app announce their saves here, so a stale one stops at once (rule 5). */
const CHANNEL_NAME = 'onabudget'

/** Daily copies kept: the newest seven days the app was used on (rule 6). */
const DAILY_COPIES_KEPT = 7

/** Epoch ms up to the end of 2999, the last year the date helpers accept. */
const MAX_TIMESTAMP = Date.UTC(2999, 11, 31, 23, 59, 59, 999)

/** How an automatic copy is stored: the copied value and when it was saved. */
interface SnapshotRecord {
  savedAt: number
  data: unknown
}

// ---------------------------------------------------------------------------------------------
// Session state

/**
 * Everything this module knows about the stored data and the save queue. One object per launch
 * (replaced only by __resetPersistenceForTests); asynchronous work checks that its session is
 * still current before touching anything.
 */
interface Session {
  init: Promise<void> | null
  /** Saving is allowed: this session loaded the stored data successfully, erased it, or started over. */
  writable: boolean
  /** Saving waits while eraseEverything runs. */
  paused: boolean
  /** Revision of the stored data this session loaded or last wrote; null when none is stored. */
  rev: number | null
  /** The value stored under KEYS.data, as loaded or last written; undefined when there is none worth copying. */
  stored: unknown
  /** meta.savedAt of `stored`. */
  storedSavedAt: number | null
  /** The newest data waiting to be written. */
  pending: AppData | null
  /** The write in flight. It never rejects. */
  inFlight: Promise<void> | null
  pumpQueued: boolean
  /** Entries the next save writes in the same transaction (quarantine, pre-migration copy). */
  extras: [string, unknown][]
  /** The raw value of a damaged load, and whether it is safe in the quarantine. */
  damaged: { raw: unknown; quarantined: boolean } | null
  /**
   * The rescue copy in localStorage is this session's to remove after the next successful save:
   * it holds this session's data, or it is one a damaged load left behind.
   */
  ownsRescue: boolean
  /** Store changes are not saved (eraseEverything replaces the data without saving it). */
  quiet: boolean
  savedOnce: boolean
  persistRequested: boolean
  subscribed: boolean
  listening: boolean
  channel: BroadcastChannel | null
  cleanups: (() => void)[]
}

function createSession(): Session {
  return {
    init: null,
    writable: false,
    paused: false,
    rev: null,
    stored: undefined,
    storedSavedAt: null,
    pending: null,
    inFlight: null,
    pumpQueued: false,
    extras: [],
    damaged: null,
    ownsRescue: false,
    quiet: false,
    savedOnce: false,
    persistRequested: false,
    subscribed: false,
    listening: false,
    channel: null,
    cleanups: [],
  }
}

let session: Session = createSession()

// ---------------------------------------------------------------------------------------------
// Status

/** Updates the status (only when a value changes) and the root element's data-save-state. */
function setStatus(patch: Partial<StorageStatus>): void {
  const current = useStorageStatus.getState()
  const keys = Object.keys(patch) as (keyof StorageStatus)[]
  if (keys.some((key) => current[key] !== patch[key])) useStorageStatus.setState(patch)
  syncDocument()
}

/** `saving` follows the queue: something is pending or in flight. */
function syncSaving(): void {
  const s = session
  setStatus({ saving: s.pending !== null || s.inFlight !== null })
}

/** data-save-state="saving" | "saved" | "error" on the root element, for e2e (rule 10). */
function syncDocument(): void {
  if (typeof document === 'undefined') return
  const { phase, saving } = useStorageStatus.getState()
  const root = document.documentElement
  if (phase === 'loading') root.removeAttribute('data-save-state')
  else root.dataset.saveState = phase === 'ok' ? (saving ? 'saving' : 'saved') : 'error'
}

/** A phase in which nothing is written. The app gets past the loading gate to show it. */
function block(phase: StoragePhase, message: string): void {
  useAppStore.setState({ status: 'ready' })
  setStatus({ phase, error: message })
  syncSaving()
}

// ---------------------------------------------------------------------------------------------
// Browser APIs, each optional and never throwing

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage access can throw a SecurityError.
    return null
  }
}

function readLocal(key: string): string | null {
  try {
    return localStore()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStore()?.setItem(key, value)
  } catch {
    // Full or unavailable: the copy is a best effort.
  }
}

function removeLocal(key: string): void {
  try {
    localStore()?.removeItem(key)
  } catch {
    // Unavailable: nothing to remove.
  }
}

/** Removes every localStorage key of the app (all start with LS_PREFIX). */
function removeAppKeys(): void {
  const storage = localStore()
  if (storage === null) return
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key?.startsWith(LS_PREFIX) === true) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Unavailable: nothing to remove.
  }
}

/** Theme and accent for public/theme-init.js, which applies them before the app loads (rule 9). */
function mirrorTheme(settings: Settings): void {
  writeLocal(LS_KEYS.theme, settings.theme)
  writeLocal(LS_KEYS.accent, settings.accent)
}

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

/** First-run data for this device: currency and number format follow its language and time zone. */
function freshData(): AppData {
  const language = typeof navigator === 'undefined' ? undefined : navigator.language
  let timeZone: string | undefined
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timeZone = undefined
  }
  return createInitialData(Date.now(), language, timeZone)
}

// ---------------------------------------------------------------------------------------------
// Stored values

interface MetaInfo {
  rev: number | null
  savedAt: number | null
  schemaVersion: number | null
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TIMESTAMP
}

/** The parts of a stored meta value this build can read; null for each one it cannot. */
function readMeta(value: unknown): MetaInfo {
  const record = isRecord(value) ? value : null
  const savedAt = record === null ? undefined : ownValue(record, 'savedAt')
  const schemaVersion = record === null ? undefined : ownValue(record, 'schemaVersion')
  return {
    rev: storedRev(value),
    savedAt: isTimestamp(savedAt) ? savedAt : null,
    schemaVersion: Number.isSafeInteger(schemaVersion) ? (schemaVersion as number) : null,
  }
}

function snapshotRecord(data: unknown, savedAt: number): SnapshotRecord {
  return { savedAt, data }
}

function readSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (!isRecord(value) || !Object.hasOwn(value, 'data')) return null
  const savedAt = ownValue(value, 'savedAt')
  return isTimestamp(savedAt) ? { savedAt, data: ownValue(value, 'data') } : null
}

function transactionCount(data: unknown): number {
  const transactions = isRecord(data) ? ownValue(data, 'transactions') : undefined
  return Array.isArray(transactions) ? transactions.length : 0
}

function snapshotLabel(key: string, locale: string): string {
  const date = dailySnapshotDate(key)
  if (date !== null) return `End of ${formatDate(date, locale, 'medium')}`
  if (key === SNAPSHOT_KEYS.preImport) return 'Before import'
  if (key === SNAPSHOT_KEYS.preRestore) return 'Before restore'
  return 'Before update'
}

/** Puts `value` in the quarantine; false when that fails. */
async function quarantine(value: unknown): Promise<boolean> {
  try {
    await getKv().set(KEYS.quarantine, value)
    return true
  } catch {
    return false
  }
}

/** JSON.stringify replacer for values JSON has no form for: BigInt becomes its digits. */
function plainJson(_key: string, item: unknown): unknown {
  return typeof item === 'bigint' ? item.toString() : item
}

/** JSON of any stored value: BigInt as text, and repeated objects marked when there are cycles. */
function toJson(value: unknown): string {
  try {
    return JSON.stringify(value, plainJson, 2)
  } catch {
    // Structured clone keeps cycles, which JSON cannot express.
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (key, item: unknown) => {
        const next = plainJson(key, item)
        if (typeof next !== 'object' || next === null) return next
        if (seen.has(next)) return '[Circular]'
        seen.add(next)
        return next
      },
      2,
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Loading (rule 1)

async function load(s: Session): Promise<void> {
  // A retry ("Try again") shows the loading screen again instead of the placeholder data.
  useAppStore.setState({ status: 'loading' })
  setStatus({ phase: 'loading', error: null })
  void readPersisted(s)

  let metaValue: unknown
  let raw: unknown
  try {
    const kv = getKv()
    // Meta first: when another window saves in between, this window holds the older revision,
    // so its first save stops at a conflict instead of overwriting the newer data.
    metaValue = await kv.get(KEYS.meta)
    raw = await kv.get(KEYS.data)
  } catch {
    if (s !== session) return
    resetKv()
    block('read-failed', STORAGE_MESSAGES.readFailed)
    return
  }
  if (s !== session) return

  const meta = readMeta(metaValue)
  s.rev = meta.rev
  if (raw === undefined) {
    // First run: nothing to normalise, nothing saved until the first change.
    await hydrateLoaded(s, freshData(), 0)
    return
  }
  if (meta.schemaVersion !== null && meta.schemaVersion > CURRENT_SCHEMA_VERSION) {
    block('newer-version', STORAGE_MESSAGES.newerVersion)
    return
  }

  let loaded: { data: AppData; report: NormalizeReport }
  try {
    loaded = normalizeAppData(raw, Date.now())
  } catch (error) {
    if (error instanceof DataError && error.code === 'newer-version') {
      block('newer-version', STORAGE_MESSAGES.newerVersion)
      return
    }
    const quarantined = await quarantine(raw)
    if (s !== session) return
    const rescue = readRescue(s.rev)
    if (rescue !== null && rescue.data !== null) {
      // The rescue copy was written on top of this very revision, so it is the newest complete
      // data there is: use it, as after a clean load. The damaged value stays in the quarantine;
      // when that write failed, the first save writes it in the same transaction.
      if (!quarantined) s.extras.push([KEYS.quarantine, raw])
      s.ownsRescue = true
      hydrate(s, rescue.data, { dropped: 0, save: true })
      return
    }
    // Any other copy stays in localStorage: the quarantine keeps the damaged value (startFresh).
    s.damaged = { raw, quarantined }
    block('damaged', error instanceof Error ? error.message : String(error))
    return
  }

  const { data, report } = loaded
  const dropped = droppedCount(report)
  // Clean data normalises to an equal value, so the daily copy can share the loaded object.
  const clean = dropped === 0 && report.repaired === 0 && report.migratedFrom === null
  s.stored = clean ? data : raw
  s.storedSavedAt = meta.savedAt
  if (report.migratedFrom !== null) {
    s.extras.push([migrationSnapshotKey(report.migratedFrom), snapshotRecord(raw, meta.savedAt ?? Date.now())])
  }
  // The first save overwrites the original, so the original goes to the quarantine with it.
  if (dropped > 0) s.extras.push([KEYS.quarantine, raw])
  await hydrateLoaded(s, data, dropped)
}

/**
 * Hydrates loaded (or first-run) data, or the rescue copy when it belongs to the stored revision.
 * A stale or unusable copy moves to the quarantine.
 */
async function hydrateLoaded(s: Session, data: AppData, dropped: number): Promise<void> {
  const rescue = readRescue(s.rev)
  if (rescue !== null && rescue.data !== null) {
    s.ownsRescue = true
    hydrate(s, rescue.data, { dropped, save: true })
    return
  }
  // When the quarantine cannot be written the copy stays, and the next launch tries again.
  if (rescue !== null && (await quarantine(rescue.value))) removeLocal(LS_KEYS.rescue)
  if (s !== session) return
  hydrate(s, data, { dropped, save: false })
}

/** The rescue copy in localStorage (rule 4), as read at load. */
interface RescueCopy {
  /** The parsed copy, or its text when that is not JSON. */
  value: unknown
  /**
   * Its data, normalised, when it was written on top of revision `rev` (the one stored now);
   * null when it is stale (another window saved since) or unusable.
   */
  data: AppData | null
}

/** The rescue copy, or null when there is none. Reading it changes nothing. */
function readRescue(rev: number | null): RescueCopy | null {
  const text = readLocal(LS_KEYS.rescue)
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = text
  }
  if (isRecord(value) && ownValue(value, 'basedOnRev') === rev) {
    try {
      return { value, data: normalizeAppData(ownValue(value, 'data'), Date.now()).data }
    } catch {
      // Unusable data: handled like a stale copy.
    }
  }
  return { value, data: null }
}

/**
 * Sets the data first and only then subscribes, so loading never triggers a save; `save` saves
 * the data right away (a rescued copy, a fresh start, a restored copy).
 */
function hydrate(s: Session, data: AppData, o: { dropped: number; save: boolean }): void {
  // The data is in place before saving is on, so hydrating never schedules a save by itself.
  useAppStore.setState({ data, status: 'ready' })
  s.writable = true
  setStatus({ phase: 'ok', error: null, droppedOnLoad: o.dropped })
  subscribe(s)
  mirrorTheme(data.settings)
  if (o.save) scheduleSave(data)
  syncSaving()
}

function subscribe(s: Session): void {
  if (s.subscribed) return
  s.subscribed = true
  s.cleanups.push(useAppStore.subscribe((state, previous) => onStoreChange(s, state, previous)))
  openChannel(s)
}

function onStoreChange(s: Session, state: AppState, previous: AppState): void {
  if (s !== session || s.quiet || state.data === previous.data || !s.writable) return
  scheduleSave(state.data)
  const { theme, accent } = state.data.settings
  if (theme !== previous.data.settings.theme || accent !== previous.data.settings.accent) {
    mirrorTheme(state.data.settings)
  }
}

/** Hidden: save what is pending before iOS suspends the app. Visible again: retry a failed write. */
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flushSaves()
  else if (useStorageStatus.getState().phase === 'write-failed') startWrite()
}

function onPageHide(): void {
  void flushSaves()
}

/** Saves pending changes when the page is hidden or closed; retries a failed write on return. */
function listen(s: Session): void {
  if (s.listening || typeof document === 'undefined' || typeof window === 'undefined') return
  s.listening = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  s.cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
  })
}

// ---------------------------------------------------------------------------------------------
// Persisted storage (rule 7)

async function readPersisted(s: Session): Promise<void> {
  let persisted: boolean | null = null
  try {
    const result: unknown = await storageManager()?.persisted?.()
    persisted = typeof result === 'boolean' ? result : null
  } catch {
    persisted = null
  }
  if (s !== session) return
  setStatus({ persisted })
  if (persisted === false && s.savedOnce) requestPersistence(s)
}

/** Asks once per launch, after the first successful save, while storage is not persisted. */
function requestPersistence(s: Session): void {
  if (s.persistRequested || useStorageStatus.getState().persisted !== false) return
  const storage = storageManager()
  if (typeof storage?.persist !== 'function') return
  s.persistRequested = true
  storage.persist().then(
    (persisted) => {
      if (s === session) setStatus({ persisted })
    },
    () => {
      // Refused or unsupported: the status keeps saying "not protected".
    },
  )
}

// ---------------------------------------------------------------------------------------------
// Other windows (rule 5)

function openChannel(s: Session): void {
  if (s.channel !== null || typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener('message', (event: MessageEvent<unknown>) => onRemoteSave(s, event.data))
    s.channel = channel
    s.cleanups.push(() => channel.close())
  } catch {
    // Without the channel a stale window still stops at its next save (ConflictError).
  }
}

function onRemoteSave(s: Session, message: unknown): void {
  if (s !== session || !s.writable) return
  const rev = isRecord(message) ? ownValue(message, 'rev') : undefined
  if (typeof rev === 'number' && (s.rev === null || rev > s.rev)) conflict(s)
}

function announce(s: Session, rev: number): void {
  try {
    s.channel?.postMessage({ rev })
  } catch {
    // A closed channel: nobody to tell.
  }
}

/** Another window saved: stop saving for good; this window must reload. */
function conflict(s: Session): void {
  s.writable = false
  s.pending = null
  setStatus({ phase: 'conflict', error: STORAGE_MESSAGES.conflict })
  syncSaving()
}

// ---------------------------------------------------------------------------------------------
// Saving (rules 2–6)

/** Queues `data` for saving: the newest pending value wins, written from a microtask. */
function scheduleSave(data: AppData): void {
  const s = session
  if (!s.writable) return
  s.pending = data
  if (!s.pumpQueued) {
    s.pumpQueued = true
    queueMicrotask(() => {
      s.pumpQueued = false
      if (s === session) startWrite()
    })
  }
  syncSaving()
}

/** Writes the pending data unless a write is in flight, nothing is pending, or saving is off or paused. */
function startWrite(): void {
  const s = session
  if (s.inFlight !== null || s.pending === null || !s.writable || s.paused) return
  const data = s.pending
  s.pending = null
  s.inFlight = write(s, data).finally(() => {
    if (s !== session) return
    s.inFlight = null
    // What changed during the write is written next. After a failure the next change, or the
    // page becoming visible, retries instead.
    if (useStorageStatus.getState().phase === 'ok') startWrite()
    syncSaving()
  })
  syncSaving()
}

/** The key of the previous day's copy when the stored data was saved on an earlier local date. */
function dailyCopyKey(s: Session, now: number): string | null {
  if (s.stored === undefined || s.storedSavedAt === null) return null
  const savedOn = localDateOf(s.storedSavedAt)
  return compareISO(savedOn, localDateOf(now)) < 0 ? dailySnapshotKey(savedOn) : null
}

async function write(s: Session, data: AppData): Promise<void> {
  const meta: StoredMeta = { rev: (s.rev ?? 0) + 1, savedAt: Date.now(), schemaVersion: CURRENT_SCHEMA_VERSION }
  let dailyKey: string | null = null
  try {
    const entries: [string, unknown][] = [...s.extras]
    dailyKey = dailyCopyKey(s, meta.savedAt)
    if (dailyKey !== null) entries.push([dailyKey, snapshotRecord(s.stored, s.storedSavedAt ?? meta.savedAt)])
    entries.push([KEYS.data, data], [KEYS.meta, meta])
    await commitWithRetry(s.rev, entries, meta)
  } catch (error) {
    // A window that stopped saving while the write was in flight (another window saved) stays in
    // conflict: whatever this write fails with, nothing is kept for a retry or a rescue copy.
    if (s !== session || !s.writable) return
    if (error instanceof ConflictError) conflict(s)
    else writeFailed(s, data, error)
    return
  }
  if (s !== session) return

  s.rev = meta.rev
  s.stored = data
  s.storedSavedAt = meta.savedAt
  s.extras = []
  s.savedOnce = true
  // A successful write ends a write failure and its message; an erase error stays for the sheet.
  if (useStorageStatus.getState().phase === 'write-failed') setStatus({ phase: 'ok', error: null })
  if (s.ownsRescue) {
    removeLocal(LS_KEYS.rescue)
    s.ownsRescue = false
  }
  announce(s, meta.rev)
  requestPersistence(s)
  if (dailyKey !== null) await pruneDailyCopies()
}

/**
 * Commits, and once more on a fresh handle when that fails (rule 4): iOS sometimes closes the
 * IndexedDB connection of an app that was in the background. A conflict is final.
 */
async function commitWithRetry(expectedRev: number | null, entries: [string, unknown][], meta: StoredMeta): Promise<void> {
  try {
    await getKv().commit(expectedRev, entries)
    return
  } catch (error) {
    if (error instanceof ConflictError) throw error
  }
  resetKv()
  try {
    await getKv().commit(expectedRev, entries)
  } catch (error) {
    // The first attempt may have been committed with only its reply lost.
    if (error instanceof ConflictError && (await holdsMeta(meta))) return
    throw error
  }
}

/** True when the stored meta is exactly `meta`. */
async function holdsMeta(meta: StoredMeta): Promise<boolean> {
  try {
    const stored = readMeta(await getKv().get(KEYS.meta))
    return stored.rev === meta.rev && stored.savedAt === meta.savedAt
  } catch {
    return false
  }
}

function isQuotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'QuotaExceededError'
}

/** Keeps the newest unsaved data for a retry and a rescue copy that survives the app closing (rule 4). */
function writeFailed(s: Session, data: AppData, error: unknown): void {
  s.pending ??= data
  writeLocal(LS_KEYS.rescue, JSON.stringify({ basedOnRev: s.rev, data: s.pending }))
  s.ownsRescue = true
  setStatus({
    phase: 'write-failed',
    error: isQuotaError(error) ? STORAGE_MESSAGES.outOfSpace : STORAGE_MESSAGES.writeFailed,
  })
}

/** Deletes daily copies beyond the newest seven. */
async function pruneDailyCopies(): Promise<void> {
  try {
    const kv = getKv()
    const daily = (await kv.keys()).filter((key) => dailySnapshotDate(key) !== null).toSorted((a, b) => compareISO(b, a))
    const old = daily.slice(DAILY_COPIES_KEPT)
    if (old.length > 0) await kv.del(old)
  } catch {
    // Best effort: the next daily copy prunes again.
  }
}

/** Replacing the data needs a session that may write. */
function assertWritable(s: Session): void {
  if (s !== session || !s.writable) throw new Error("The app can't save right now, so nothing was replaced.")
}

// ---------------------------------------------------------------------------------------------
// API

/**
 * Loads, normalises and hydrates the app store, then starts saving. Idempotent: a second call
 * returns the first promise, except after 'read-failed', when it tries again ("Try again"). Never
 * rejects; the outcome shows in useStorageStatus.
 */
export function initStore(): Promise<void> {
  const s = session
  if (s.init === null || useStorageStatus.getState().phase === 'read-failed') {
    listen(s)
    s.init = load(s).catch(() => {
      if (s === session) block('read-failed', STORAGE_MESSAGES.readFailed)
    })
  }
  return s.init
}

/**
 * Resolves when nothing is pending or in flight: it waits for the write in flight and writes what
 * is pending. When that write fails it resolves anyway; the data stays pending for a retry.
 */
export async function flushSaves(): Promise<void> {
  const s = session
  let attempted = false
  for (;;) {
    if (s !== session) return
    if (s.inFlight !== null) {
      await s.inFlight
      continue
    }
    if (s.pending === null || !s.writable || s.paused) return
    if (attempted && useStorageStatus.getState().phase === 'write-failed') return
    attempted = true
    startWrite()
    if (s.inFlight === null) return
  }
}

/**
 * Replaces all data with an imported backup (from parseBackup): flush, copy the current data to
 * 'snap:pre-import' (skipped when no data is stored: a first run, or after an erase), replace,
 * save. Rejects, replacing nothing, when saving is off or the copy cannot be written. In
 * 'memory-only' it replaces the data in memory.
 */
export async function importData(data: AppData): Promise<void> {
  const s = session
  if (useStorageStatus.getState().phase === 'memory-only') {
    useAppStore.setState({ data })
    return
  }
  assertWritable(s)
  await flushSaves()
  assertWritable(s)
  if (s.stored !== undefined) {
    await getKv().set(SNAPSHOT_KEYS.preImport, snapshotRecord(getData(), Date.now()))
    assertWritable(s)
  }
  useAppStore.setState({ data })
  await flushSaves()
}

/** Automatic copies, newest first. Rejects when the stored keys cannot be read. */
export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const kv = getKv()
  const keys = (await kv.keys()).filter(isSnapshotKey)
  const records = await Promise.all(keys.map(async (key) => ({ key, record: readSnapshotRecord(await kv.get(key)) })))
  const locale = getData().settings.locale
  const copies: SnapshotInfo[] = []
  for (const { key, record } of records) {
    if (record === null) continue
    copies.push({ key, label: snapshotLabel(key, locale), savedAt: record.savedAt, transactions: transactionCount(record.data) })
  }
  return copies.toSorted((a, b) => b.savedAt - a.savedAt || compareISO(b.key, a.key))
}

/**
 * Leaves 'damaged' with `data`, once the damaged value is safe in the quarantine. A rescue copy
 * that the load left in localStorage (stale or unusable) goes with the first save of `data`: moved
 * to the quarantine at the next launch, it would take the damaged value's place.
 */
async function leaveDamaged(s: Session, data: AppData): Promise<void> {
  const damaged = s.damaged
  if (damaged !== null && !damaged.quarantined) {
    await getKv().set(KEYS.quarantine, damaged.raw)
    damaged.quarantined = true
  }
  if (s !== session) return
  s.damaged = null
  s.ownsRescue = readLocal(LS_KEYS.rescue) !== null
  hydrate(s, data, { dropped: 0, save: true })
  await flushSaves()
}

/**
 * Restores an automatic copy after snapshotting the current data as 'snap:pre-restore'. From
 * 'damaged' it replaces the damaged data instead (the quarantine keeps the original) and turns
 * saving on. Rejects with a RangeError for a key that names no copy, and with a DataError when
 * the copy cannot be used.
 */
export async function restoreSnapshot(key: string): Promise<void> {
  if (!isSnapshotKey(key)) throw new RangeError(`Not an automatic copy: ${key}`)
  const s = session
  const { phase } = useStorageStatus.getState()
  if (phase !== 'damaged' && phase !== 'memory-only') assertWritable(s)
  const record = readSnapshotRecord(await getKv().get(key))
  if (record === null) throw new DataError('damaged', "This copy is missing or damaged and can't be restored.")
  const { data } = normalizeAppData(record.data, Date.now())
  if (s !== session) return

  if (phase === 'damaged') {
    await leaveDamaged(s, data)
    return
  }
  if (phase === 'memory-only') {
    useAppStore.setState({ data })
    return
  }
  await flushSaves()
  assertWritable(s)
  await getKv().set(SNAPSHOT_KEYS.preRestore, snapshotRecord(getData(), Date.now()))
  assertWritable(s)
  useAppStore.setState({ data })
  await flushSaves()
}

/** After 'damaged': keeps the quarantined value, resets the data and turns saving on. */
export async function startFresh(): Promise<void> {
  const s = session
  if (useStorageStatus.getState().phase !== 'damaged') throw new Error('Only damaged data can be replaced with a fresh start.')
  await leaveDamaged(s, freshData())
}

/** After 'read-failed': continue with fresh data in memory (phase 'memory-only'). */
export function continueWithoutSaving(): void {
  if (useStorageStatus.getState().phase !== 'read-failed') return
  session.writable = false
  useAppStore.setState({ data: freshData(), status: 'ready' })
  setStatus({ phase: 'memory-only', error: null })
}

/**
 * The §5.4 name of continueWithoutSaving. It is not a hook: call continueWithoutSaving from event
 * handlers, because rules-of-hooks rejects calls to use* functions inside callbacks.
 */
export const useWithoutSaving: () => void = continueWithoutSaving

/**
 * The meta of an empty store, written right after an erase: revision `rev` with no data, so the
 * next save, in any window or after a relaunch, goes on from it. True when it was written.
 */
async function writeEraseMarker(rev: number): Promise<boolean> {
  const marker: StoredMeta = { rev, savedAt: Date.now(), schemaVersion: CURRENT_SCHEMA_VERSION }
  try {
    await getKv().set(KEYS.meta, marker)
    return true
  } catch {
    // The erase has happened all the same; revisions then start over at the next save.
    return false
  }
}

/**
 * Deletes every stored value and the app's localStorage keys, then resets data and security
 * (rule 8): saving stops, the write in flight finishes, the kv store is cleared, and the fresh
 * data is not saved until it changes. Only a revision marker stays (a meta without data):
 * revisions go on past the newest one any window may hold instead of starting over at 1, so a
 * window that loaded the erased data can never save over the new data by holding a matching
 * revision (rule 5), and the marker is announced so such windows stop at once. When clearing
 * fails nothing changes except the status error, and the promise rejects with that message.
 */
export async function eraseEverything(): Promise<void> {
  const s = session
  s.paused = true
  let newestRev: number | null
  try {
    if (s.inFlight !== null) await s.inFlight
    const kv = getKv()
    // Another window may hold a newer revision than this one; unreadable counts as none.
    newestRev = storedRev(await kv.get(KEYS.meta).catch(() => undefined))
    await kv.clear()
  } catch (error) {
    if (s === session) {
      s.paused = false
      setStatus({ error: STORAGE_MESSAGES.eraseFailed })
      startWrite()
    }
    throw new Error(STORAGE_MESSAGES.eraseFailed, { cause: error })
  }
  if (s !== session) return

  removeAppKeys()
  s.quiet = true
  try {
    useAppStore.setState({ data: freshData(), status: 'ready' })
  } finally {
    s.quiet = false
  }
  // The marker's revision. Held from now on, so announcements of saves from before the erase,
  // still on their way, are recognised as older.
  const rev = Math.max(s.rev ?? 0, newestRev ?? 0) + 1
  s.writable = true
  s.rev = rev
  s.stored = undefined
  s.storedSavedAt = null
  s.pending = null
  s.extras = []
  s.damaged = null
  s.ownsRescue = false
  resetSecurity()
  useUiStore.setState({ amountsRevealed: false })
  setStatus({ phase: 'ok', error: null, droppedOnLoad: 0 })
  subscribe(s)

  // Saving stays paused until the marker is down; changes made meanwhile are written after it.
  const marked = await writeEraseMarker(rev)
  if (s !== session) return
  // Without the marker nothing is stored, so the next save is a first one.
  if (!marked) s.rev = null
  announce(s, rev)
  s.paused = false
  startWrite()
  syncSaving()
}

/** The raw stored value as JSON, for exporting damaged data; null when there is none. */
export async function exportRawData(): Promise<string | null> {
  const kv = getKv()
  const stored = await kv.get(KEYS.data)
  const raw = stored === undefined ? await kv.get(KEYS.quarantine) : stored
  return raw === undefined ? null : toJson(raw)
}

/** Resets module state between tests: listeners, channel, queue, status and the app store. */
export function __resetPersistenceForTests(): void {
  for (const cleanup of session.cleanups) cleanup()
  session = createSession()
  useStorageStatus.setState(useStorageStatus.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-save-state')
}
