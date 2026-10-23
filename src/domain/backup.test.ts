import { describe, expect, it } from 'vitest'
import {
  BACKUP_ERROR_MESSAGES,
  backupFileName,
  createBackup,
  csvFileName,
  parseBackup,
  serializeBackup,
  transactionsToCsv,
} from '@/domain/backup'
import { createDefaultSecurity, createInitialData, CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { DataError, droppedCount, type DataErrorCode, type NormalizeReport } from '@/domain/normalize'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import {
  appDataProblems,
  makeCategory,
  makeData,
  makeSplit,
  makeTransaction,
  NOW,
  sampleData,
  toRaw,
} from '@/domain/test-helpers/dataFixtures'
import type { AppData, Transaction } from '@/domain/types'

type Raw = Record<string, unknown>

const CLEAN_REPORT: NormalizeReport = {
  migratedFrom: null,
  dropped: { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 },
  repaired: 0,
}

const BOM = '\u{FEFF}'
const CSV_HEADER = 'date,type,category,note,amount,currency,my_share,paid_from'

/** The text of a backup of `data` exported at NOW. */
function backupText(data: AppData = sampleData()): string {
  return serializeBackup(createBackup(data, NOW))
}

/** A backup file as parsed JSON, with top-level `fields` replaced, serialised again. */
function fileWith(fields: Raw, data: AppData = sampleData()): string {
  return JSON.stringify({ ...toRaw(createBackup(data, NOW)), ...fields })
}

/** The DataError parseBackup throws for `text`; fails the test when it throws nothing or something else. */
function parseError(text: string): DataError {
  try {
    parseBackup(text, NOW)
  } catch (error) {
    if (error instanceof DataError) return error
    throw error
  }
  throw new Error('Expected a DataError')
}

/** How parseBackup refuses `text`: the error code and message. */
function refusal(text: string): { code: DataErrorCode; message: string } {
  const { code, message } = parseError(text)
  return { code, message }
}

/** A refusal with `code` and the §4.7 message for it. */
function refused(code: DataErrorCode): { code: DataErrorCode; message: string } {
  return { code, message: BACKUP_ERROR_MESSAGES[code] }
}

/** The CSV of data whose only transactions are `transactions`, in `currency`. */
function csvOf(transactions: Transaction[], currency = 'EUR'): string {
  const data = makeData({ transactions })
  return transactionsToCsv({ ...data, settings: { ...data.settings, currency } })
}

/** The data rows of a CSV, without BOM, header and line ends. */
function csvRows(csv: string): string[] {
  return csv.slice(BOM.length).split('\r\n').slice(1, -1)
}

/** The note column of the single row for an expense with `note`. */
function csvNote(note: string): string {
  const row = csvRows(csvOf([makeTransaction({ note })]))[0] ?? ''
  // date,type,category,<note>,amount,currency,my_share,paid_from: the note sits between the third
  // comma and the fourth from the end, whatever it contains.
  const start = row.split(',', 3).join(',').length + 1
  let end = row.length
  for (let i = 0; i < 4; i += 1) end = row.lastIndexOf(',', end - 1)
  return row.slice(start, end)
}

/** The fields of one CSV row: commas separate them, except inside quotes, where "" is one quote. */
function splitCsvRow(row: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < row.length; i += 1) {
    const char = row.charAt(i)
    if (quoted && char === '"' && row.charAt(i + 1) === '"') {
      field += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

/** The columns after the note in the single row for `tx`: amount, currency, my_share, paid_from. */
function csvTail(tx: Transaction, currency = 'EUR'): string[] {
  return (csvRows(csvOf([tx], currency))[0] ?? '').split(',').slice(-4)
}

/** `data` as an older build saved it, before split bills, wallet payments, goals and reviews. */
function withoutExtras(data: AppData): Raw {
  const raw = toRaw(data)
  delete (raw.settings as Raw).lastReviewedMonth
  delete (raw.wallet as Raw).goals
  for (const tx of raw.transactions as Raw[]) {
    delete tx.fromWallet
    delete tx.splits
  }
  return raw
}

describe('BACKUP_ERROR_MESSAGES', () => {
  it('words each error as §4.7 says', () => {
    expect(BACKUP_ERROR_MESSAGES).toEqual({
      'not-backup': "This file isn't an On a Budget backup.",
      'newer-version':
        'This backup was made by a newer version of the app. Close the app, open it again to update, then import again.',
      damaged: "This backup is damaged and can't be imported.",
    })
  })
})

describe('createBackup', () => {
  it('wraps the data with the app id, kind, schema version and export time', () => {
    const data = sampleData()
    const backup = createBackup(data, NOW)
    expect(backup).toEqual({
      app: 'on-a-budget',
      kind: 'backup',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: '2026-10-14T08:00:00.000Z',
      data,
    })
    expect(backup.data).toBe(data)
  })

  it("takes the schema version from the data, so the two always agree", () => {
    const data = { ...makeData(), schemaVersion: 7 }
    expect(createBackup(data, NOW).schemaVersion).toBe(7)
  })
})

describe('serializeBackup', () => {
  it('writes indented JSON that ends with a newline', () => {
    const text = backupText()
    expect(text.startsWith('{\n  "app": "on-a-budget",\n  "kind": "backup",\n')).toBe(true)
    expect(text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(toRaw(createBackup(sampleData(), NOW)))
  })

  it('holds no part of the app lock', () => {
    const text = backupText()
    for (const key of Object.keys(createDefaultSecurity())) expect(text).not.toContain(`"${key}"`)
  })
})

describe('parseBackup', () => {
  describe('round trip', () => {
    it('gives back first-run data unchanged', () => {
      const data = createInitialData(NOW, 'de-DE', 'Europe/Berlin')
      const parsed = parseBackup(serializeBackup(createBackup(data, NOW)), NOW + 60_000)
      expect(parsed.data).toStrictEqual(data)
      expect(parsed.report).toStrictEqual(CLEAN_REPORT)
      expect(parsed.exportedAt).toBe('2026-10-14T08:00:00.000Z')
    })

    it('gives back realistic data unchanged', () => {
      const data = sampleData()
      const parsed = parseBackup(backupText(data), NOW)
      expect(parsed.data).toStrictEqual(data)
      expect(parsed.report).toStrictEqual(CLEAN_REPORT)
    })

    it('reads a file that an editor saved with a byte order mark and Windows line ends', () => {
      const text = BOM + backupText().replaceAll('\n', '\r\n')
      expect(parseBackup(text, NOW).data).toStrictEqual(sampleData())
    })

    it('reads a file without indentation', () => {
      expect(parseBackup(fileWith({}), NOW).data).toStrictEqual(sampleData())
    })

    it('keeps split bills, wallet payments, savings goals and the reviewed month', () => {
      const data = sampleData()
      const parsed = parseBackup(backupText(data), NOW)
      const statuses = parsed.data.transactions.flatMap(({ splits }) => splits.map(({ status }) => status))
      expect(statuses.toSorted()).toEqual(['forgiven', 'open', 'paid'])
      expect(parsed.data.transactions.filter(({ fromWallet }) => fromWallet).map(({ id }) => id)).toEqual(['tx-sale'])
      expect(parsed.data.wallet.goals).toStrictEqual(data.wallet.goals)
      expect(parsed.data.settings.lastReviewedMonth).toBe('2026-09')
      expect(parsed.report).toStrictEqual(CLEAN_REPORT)
    })

    it('reads a backup made before those existed with their defaults, reporting no damage (§5.9)', () => {
      const data = sampleData()
      const parsed = parseBackup(fileWith({ data: withoutExtras(data) }), NOW)
      expect(parsed.data).toStrictEqual({
        ...data,
        settings: { ...data.settings, lastReviewedMonth: null },
        transactions: data.transactions.map((tx) => ({ ...tx, fromWallet: false, splits: [] })),
        wallet: { ...data.wallet, goals: [] },
      })
      expect(droppedCount(parsed.report)).toBe(0)
      expect(parsed.report.dropped).toStrictEqual(CLEAN_REPORT.dropped)
      expect(parsed.report.migratedFrom).toBeNull()
      // Each missing field is filled in: two per transaction, the goals and the reviewed month.
      expect(parsed.report.repaired).toBe(2 * data.transactions.length + 2)
      expect(appDataProblems(parsed.data)).toEqual([])
    })
  })

  describe('refuses', () => {
    it.each(['', 'hello', '{', 'PK\u0003\u0004', `${CSV_HEADER}\r\n`, BOM])('text that is not JSON, %j, as not a backup', (text) => {
      expect(refusal(text)).toEqual(refused('not-backup'))
    })

    it('a backup cut short as damaged', () => {
      const text = backupText()
      expect(refusal(text.slice(0, Math.floor(text.length / 2)))).toEqual(refused('damaged'))
    })

    it.each([
      '[]',
      '42',
      'null',
      '"on-a-budget"',
      '{}',
      '{"app":"other-app","kind":"backup"}',
      '{"app":"on-a-budget","kind":"snapshot"}',
      '{"kind":"backup"}',
    ])('the JSON %s as not a backup', (text) => {
      expect(refusal(text)).toEqual(refused('not-backup'))
    })

    it('bare app data without the backup wrapper as not a backup', () => {
      expect(refusal(JSON.stringify(sampleData()))).toEqual(refused('not-backup'))
    })

    it.each([
      ['no data', { data: undefined }],
      ['data that is a list', { data: [] }],
      ['data that is text', { data: 'data' }],
      ['no outer schema version', { schemaVersion: undefined }],
      ['an outer schema version that differs', { schemaVersion: 0 }],
      ['an outer schema version as text', { schemaVersion: '1' }],
      ['no export time', { exportedAt: undefined }],
      ['an export time that is no time', { exportedAt: 'yesterday' }],
      ['an export time that is a number', { exportedAt: NOW }],
    ])('a file with %s as damaged', (_case, fields) => {
      expect(refusal(fileWith(fields))).toEqual(refused('damaged'))
    })

    it.each(['categories', 'recurring', 'transactions', 'quickAdds'])('data without %s as damaged', (key) => {
      const data = toRaw(sampleData())
      delete data[key]
      expect(refusal(JSON.stringify({ ...toRaw(createBackup(sampleData(), NOW)), data }))).toEqual(refused('damaged'))
    })

    it('data without a schema version as damaged', () => {
      const data = toRaw(sampleData())
      delete data.schemaVersion
      expect(refusal(JSON.stringify({ ...toRaw(createBackup(sampleData(), NOW)), data }))).toEqual(refused('damaged'))
    })

    it.each([
      [2, 2],
      [2, 1],
      [99, undefined],
    ])('data of schema %d (outer %j) as made by a newer version', (dataVersion, outerVersion) => {
      const data = { ...toRaw(sampleData()), schemaVersion: dataVersion }
      expect(refusal(fileWith({ data, schemaVersion: outerVersion }))).toEqual(refused('newer-version'))
    })

    it('keeps what went wrong as the cause', () => {
      expect(parseError('{').cause).toBeInstanceOf(SyntaxError)
      expect(parseError(fileWith({ data: { schemaVersion: 1 } })).cause).toBeInstanceOf(DataError)
    })
  })

  describe('normalises the data', () => {
    it('drops damaged rows and reports them', () => {
      const data = toRaw(sampleData())
      ;(data.transactions as Raw[]).push({ kind: 'expense', amount: -5, date: '2026-10-14' })
      const parsed = parseBackup(fileWith({ data }), NOW)
      expect(parsed.data).toStrictEqual(sampleData())
      expect(parsed.report.dropped.transactions).toBe(1)
    })

    it('repairs fields and reports the repairs', () => {
      const data = toRaw(sampleData())
      ;(data.settings as Raw).theme = 'neon'
      const parsed = parseBackup(fileWith({ data }), NOW)
      expect(parsed.data.settings.theme).toBe('system')
      expect(parsed.report.repaired).toBe(1)
    })

    it('ignores extra fields, an app lock included, wherever they are', () => {
      const data = { ...toRaw(sampleData()), security: createDefaultSecurity() }
      const parsed = parseBackup(fileWith({ data, security: createDefaultSecurity(), note: 'mine' }), NOW)
      expect(parsed.data).toStrictEqual(sampleData())
      expect(appDataProblems(parsed.data)).toEqual([])
    })

    it('ignores __proto__ keys in the file', () => {
      const text = backupText().replace('{\n  "app"', '{\n  "__proto__": { "app": "x", "kind": "x" },\n  "app"')
      expect(text).toContain('"__proto__"')
      expect(parseBackup(text, NOW).data).toStrictEqual(sampleData())
      expect(({} as Raw).app).toBeUndefined()
    })

    it('returns the export time as written', () => {
      expect(parseBackup(fileWith({ exportedAt: '2026-10-01T12:00:00+02:00' }), NOW).exportedAt).toBe(
        '2026-10-01T12:00:00+02:00',
      )
    })
  })
})

describe('backupFileName', () => {
  it('names the file after the local date', () => {
    expect(backupFileName(NOW)).toBe('on-a-budget-backup-2026-10-14.json')
  })

  it('uses the local date, not the UTC one, around midnight', () => {
    // 00:30 in Berlin is still the 13th in UTC; 23:59 in Berlin is already the 14th's last minute.
    expect(backupFileName(Date.UTC(2026, 9, 13, 22, 30))).toBe('on-a-budget-backup-2026-10-14.json')
    expect(backupFileName(Date.UTC(2026, 9, 14, 21, 59))).toBe('on-a-budget-backup-2026-10-14.json')
  })
})

describe('csvFileName', () => {
  it('names the file after the local date', () => {
    expect(csvFileName(NOW)).toBe('on-a-budget-spending-2026-10-14.csv')
    expect(csvFileName(Date.UTC(2026, 11, 31, 23, 30))).toBe('on-a-budget-spending-2027-01-01.csv')
  })
})

describe('transactionsToCsv', () => {
  it('writes only the byte order mark and the header when there is nothing to export', () => {
    expect(csvOf([])).toBe(`${BOM}${CSV_HEADER}\r\n`)
  })

  it('writes one row per transaction, oldest first, every row ending in CRLF', () => {
    const csv = csvOf([
      makeTransaction({ id: 'tx-b', note: 'Coffee "large"', createdAt: NOW }),
      makeTransaction({ id: 'tx-a', kind: 'income', amount: 5000, date: '2026-10-13', note: 'Grandma' }),
      makeTransaction({ id: 'tx-c', amount: 5, categoryId: UNCATEGORIZED_ID, note: '=SUM(A1:A2)', createdAt: NOW - 5000 }),
      makeTransaction({ id: 'tx-d', amount: 123456, categoryId: 'cat-gone', date: '2026-10-01', note: '-20% sale, shoes' }),
    ])
    expect(csv).toBe(
      [
        `${BOM}${CSV_HEADER}`,
        `2026-10-01,expense,Uncategorized,"'-20% sale, shoes",1234.56,EUR,1234.56,budget`,
        '2026-10-13,income,,Grandma,50.00,EUR,,',
        "2026-10-14,expense,Uncategorized,'=SUM(A1:A2),0.05,EUR,0.05,budget",
        '2026-10-14,expense,Coffee & snacks,"Coffee ""large""",3.50,EUR,3.50,budget',
        '',
      ].join('\r\n'),
    )
  })

  it('writes the header of §4.7', () => {
    expect(csvOf([]).slice(BOM.length)).toBe('date,type,category,note,amount,currency,my_share,paid_from\r\n')
  })

  it('exports realistic data with every column', () => {
    expect(transactionsToCsv(sampleData())).toBe(
      [
        `${BOM}${CSV_HEADER}`,
        '2026-08-01,expense,Other,Before On a Budget,42.00,EUR,42.00,budget',
        '2026-08-04,expense,Eating,Mensa,4.50,EUR,4.50,budget',
        '2026-09-12,expense,Groceries,"Weekly shop, ""big"" one",32.87,EUR,16.44,budget',
        `2026-10-02,expense,Shopping,"'-20% sale, shoes",59.99,EUR,59.99,wallet`,
        '2026-10-10,expense,Books,Analysis 1 📘,24.00,EUR,16.00,budget',
        '2026-10-11,expense,Uncategorized,,9.90,EUR,9.90,budget',
        "2026-10-12,expense,Uncategorized,'=SUM(A1:A2),15.00,EUR,15.00,budget",
        '2026-10-13,income,,Grandma,50.00,EUR,,',
        '2026-10-14,expense,Coffee & snacks,Coffee,3.50,EUR,3.50,budget',
        '',
      ].join('\r\n'),
    )
  })

  describe('my_share and paid_from', () => {
    const settled = { settledAt: NOW }

    it('writes the share left after the splits still owed or paid back (§4.9)', () => {
      const tx = makeTransaction({
        amount: 2400,
        splits: [
          makeSplit({ id: 's-open', amount: 800 }),
          makeSplit({ id: 's-paid', person: 'Jonas', amount: 400, status: 'paid', ...settled }),
          makeSplit({ id: 's-forgiven', person: 'Lena', amount: 800, status: 'forgiven', ...settled }),
        ],
      })
      expect(csvTail(tx)).toEqual(['24.00', 'EUR', '12.00', 'budget'])
    })

    it('counts a forgiven split as the user’s own spending again', () => {
      const tx = makeTransaction({ amount: 1000, splits: [makeSplit({ amount: 1000, status: 'forgiven', ...settled })] })
      expect(csvTail(tx)).toEqual(['10.00', 'EUR', '10.00', 'budget'])
    })

    it('writes a share of 0 for an expense split in full', () => {
      const tx = makeTransaction({
        amount: 1000,
        splits: [makeSplit({ amount: 600 }), makeSplit({ id: 'split-2', person: 'Jonas', amount: 400, status: 'paid', ...settled })],
      })
      expect(csvTail(tx)).toEqual(['10.00', 'EUR', '0.00', 'budget'])
      expect(csvTail(tx, 'JPY')).toEqual(['10', 'JPY', '0', 'budget'])
    })

    it('writes the share in the currency’s digits', () => {
      const tx = makeTransaction({ amount: 35000, splits: [makeSplit({ amount: 10001 })] })
      expect(csvTail(tx, 'JPY')).toEqual(['350', 'JPY', '250', 'budget'])
      expect(csvTail(tx, 'EUR')).toEqual(['350.00', 'EUR', '249.99', 'budget'])
    })

    it('writes the whole amount as the share of an expense that is not split', () => {
      expect(csvTail(makeTransaction({ amount: 1234 }))).toEqual(['12.34', 'EUR', '12.34', 'budget'])
    })

    it('says an expense paid from the wallet came from the wallet (§3.13), split or not', () => {
      expect(csvTail(makeTransaction({ fromWallet: true }))).toEqual(['3.50', 'EUR', '3.50', 'wallet'])
      const shared = makeTransaction({ amount: 5000, fromWallet: true, splits: [makeSplit({ amount: 2000 })] })
      expect(csvTail(shared)).toEqual(['50.00', 'EUR', '30.00', 'wallet'])
    })

    it('leaves both empty for income', () => {
      const income = makeTransaction({ kind: 'income', amount: 5000, note: 'Grandma' })
      expect(csvRows(csvOf([income]))).toEqual(['2026-10-14,income,,Grandma,50.00,EUR,,'])
    })

    it('gives every row of realistic data the eight columns of the header', () => {
      const header = CSV_HEADER.split(',')
      const fields = csvRows(transactionsToCsv(sampleData())).map(splitCsvRow)
      expect(fields.filter((row) => row.length !== header.length)).toEqual([])
      expect(fields.map((row) => row.slice(6))).toEqual([
        ['42.00', 'budget'],
        ['4.50', 'budget'],
        ['16.44', 'budget'],
        ['59.99', 'wallet'],
        ['16.00', 'budget'],
        ['9.90', 'budget'],
        ['15.00', 'budget'],
        ['', ''],
        ['3.50', 'budget'],
      ])
    })
  })

  it('never ends a line with a bare LF', () => {
    const csv = transactionsToCsv(sampleData())
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it('orders rows by date, then creation time, then id', () => {
    const csv = csvOf([
      makeTransaction({ id: 'b', note: 'third', createdAt: NOW }),
      makeTransaction({ id: 'a', note: 'second', createdAt: NOW }),
      makeTransaction({ id: 'c', note: 'first', createdAt: NOW - 1 }),
      makeTransaction({ id: 'd', note: 'last', date: '2026-10-15', createdAt: NOW - 10_000 }),
      makeTransaction({ id: 'e', note: 'earliest', date: '2026-09-30', createdAt: NOW + 10_000 }),
    ])
    expect(csvRows(csv).map((row) => row.split(',')[3])).toEqual(['earliest', 'first', 'second', 'third', 'last'])
  })

  it('leaves the order of the data alone', () => {
    const data = sampleData()
    const before = data.transactions.map(({ id }) => id)
    transactionsToCsv(data)
    expect(data.transactions.map(({ id }) => id)).toEqual(before)
  })

  it('names the category of each expense, archived ones too, and none for income', () => {
    const base = makeData()
    const data: AppData = {
      ...base,
      categories: [...base.categories, makeCategory('cat-old', { name: 'Old stuff', archived: true })],
      transactions: [
        makeTransaction({ id: 'tx-1', categoryId: 'cat-old' }),
        makeTransaction({ id: 'tx-2', categoryId: 'cat-groceries' }),
        makeTransaction({ id: 'tx-3', kind: 'income', categoryId: null }),
        makeTransaction({ id: 'tx-4', categoryId: 'constructor' }),
      ],
    }
    expect(csvRows(transactionsToCsv(data)).map((row) => row.split(',')[2])).toEqual([
      'Old stuff',
      'Groceries',
      '',
      'Uncategorized',
    ])
  })

  it.each([
    ['EUR', 350, '3.50'],
    ['EUR', 5, '0.05'],
    ['EUR', 123456, '1234.56'],
    ['EUR', 9_999_999_999, '99999999.99'],
    ['USD', 100, '1.00'],
    ['JPY', 35000, '350'],
    ['ALL', 150000, '1500'],
  ])('writes %s %d as the plain decimal %s', (currency, amount, expected) => {
    expect(csvTail(makeTransaction({ amount }), currency)).toEqual([expected, currency, expected, 'budget'])
  })

  it('writes amounts without a sign, whatever the kind', () => {
    const rows = csvRows(csvOf([makeTransaction({ id: 'a' }), makeTransaction({ id: 'b', kind: 'income', categoryId: null })]))
    expect(rows.map((row) => row.split(',')[4])).toEqual(['3.50', '3.50'])
  })

  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['-20% sale, shoes', `"'-20% sale, shoes"`],
    ['Coffee "large"', '"Coffee ""large"""'],
    ['+49 call', "'+49 call"],
    ['@home', "'@home"],
    ['\tTab first', "'\tTab first"],
    ['\rReturn first', `"'\rReturn first"`],
    ['line\nbreak', '"line\nbreak"'],
    ['a,b', '"a,b"'],
    ['"', '""""'],
    ['Coffee', 'Coffee'],
    ['Analysis 1 📘', 'Analysis 1 📘'],
    ['', ''],
    ['3 - 1 = 2', '3 - 1 = 2'],
  ])('escapes the note %j as %j', (note, expected) => {
    expect(csvNote(note)).toBe(expected)
  })

  it('escapes category names the same way', () => {
    const base = makeData()
    const data: AppData = {
      ...base,
      categories: [
        makeCategory('cat-a', { name: '=cmd' }),
        makeCategory('cat-b', { name: 'Food, drinks' }),
        makeCategory('cat-c', { name: 'Say "hi"' }),
      ],
      transactions: ['cat-a', 'cat-b', 'cat-c'].map((categoryId, i) =>
        makeTransaction({ id: `tx-${i}`, categoryId, createdAt: NOW + i }),
      ),
    }
    expect(csvRows(transactionsToCsv(data))).toEqual([
      "2026-10-14,expense,'=cmd,,3.50,EUR,3.50,budget",
      '2026-10-14,expense,"Food, drinks",,3.50,EUR,3.50,budget',
      '2026-10-14,expense,"Say ""hi""",,3.50,EUR,3.50,budget',
    ])
  })

  it('writes the currency of the settings in every row', () => {
    const rows = csvRows(csvOf([makeTransaction({ id: 'a' }), makeTransaction({ id: 'b', kind: 'income', categoryId: null })], 'CHF'))
    expect(rows.map((row) => row.split(',')[5])).toEqual(['CHF', 'CHF'])
  })

  it('exports every transaction of realistic data', () => {
    const data = sampleData()
    expect(csvRows(transactionsToCsv(data))).toHaveLength(data.transactions.length)
  })
})
