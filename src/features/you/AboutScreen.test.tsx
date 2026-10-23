import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { AboutScreen } from '@/features/you/AboutScreen'
import { useAppStore } from '@/store/appStore'
import { useStorageStatus } from '@/store/persistence'

function show() {
  return render(<AboutScreen />)
}

function stubEstimate(usage: number | undefined): void {
  Object.defineProperty(navigator, 'storage', {
    value: { estimate: () => Promise.resolve({ usage, quota: 1e9 }) },
    configurable: true,
  })
}

beforeEach(() => {
  useAppStore.setState({ data: makeData(), status: 'ready' })
  useStorageStatus.setState({ phase: 'ok', persisted: true })
  __resetNavForTests()
  useNav.setState({ stacks: { home: [{ name: 'you' }, { name: 'you.about' }], daily: [], fixed: [], wallet: [] } })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'storage')
  vi.useRealTimers()
  __resetNavForTests()
  useStorageStatus.setState(useStorageStatus.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('AboutScreen (docs/SPEC.md §3.7)', () => {
  it('names the app and its version', () => {
    show()
    expect(screen.getByRole('heading', { name: 'About', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^On a Budget Version \d+\.\d+\.\d+/ })).toBeInTheDocument()
  })

  it('opens Diagnostics after five taps on the version, and only then', async () => {
    const user = userEvent.setup()
    show()
    const version = screen.getByRole('button', { name: /Version/ })
    for (let i = 0; i < 4; i += 1) await user.click(version)
    expect(useNav.getState().stacks.home.map((r) => r.name)).toEqual(['you', 'you.about'])
    await user.click(version)
    expect(useNav.getState().stacks.home.map((r) => r.name)).toEqual(['you', 'you.about', 'you.diagnostics'])
  })

  it('starts counting again after a pause between taps', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    const version = screen.getByRole('button', { name: /Version/ })
    for (let i = 0; i < 3; i += 1) await user.click(version)
    vi.advanceTimersByTime(2000)
    for (let i = 0; i < 4; i += 1) await user.click(version)
    expect(useNav.getState().stacks.home).toHaveLength(2)
    await user.click(version)
    expect(useNav.getState().stacks.home).toHaveLength(3)
  })

  it('says where the data lives, how much space it takes and whether iOS may clear it', async () => {
    stubEstimate(412_000)
    show()
    expect(screen.getByRole('heading', { name: 'Where your data lives' })).toBeInTheDocument()
    expect(screen.getByText(/^Your entries are kept only in this Home Screen app, on this iPhone\./)).toBeInTheDocument()
    expect(screen.getByText(/no account, no server and no analytics/)).toBeInTheDocument()
    expect(screen.getByText('Protected from automatic cleanup')).toBeInTheDocument()
    expect(await screen.findByText('412 kB')).toBeInTheDocument()
    expect(screen.getByText('Space used')).toBeInTheDocument()
  })

  it('leaves out the space used where the browser cannot tell', () => {
    show()
    expect(screen.queryByText('Space used')).toBeNull()
  })

  it('shows the install guide', () => {
    show()
    expect(screen.getByRole('heading', { name: 'How to install' })).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: 'How to install' })).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
  })

  it('credits the open-source components with their licenses', async () => {
    const user = userEvent.setup()
    show()
    expect(screen.getByRole('heading', { name: 'Open-source notices' })).toBeInTheDocument()
    const phosphor = screen.getByText('Phosphor Icons').closest('details')
    if (phosphor === null) throw new Error('Phosphor Icons has no notice')
    expect(phosphor).toHaveTextContent('MIT License')
    expect(phosphor.open).toBe(false)
    await user.click(within(phosphor).getByText('Phosphor Icons'))
    await waitFor(() => expect(phosphor.open).toBe(true))
    expect(phosphor).toHaveTextContent('Copyright (c) 2023 Phosphor Icons')
    expect(phosphor).toHaveTextContent('Permission is hereby granted, free of charge')
    expect(screen.getByText('Source Serif 4').closest('details')).toHaveTextContent('SIL Open Font License 1.1')
  })

  it('gives the whole Apache License with idb-keyval, after its notice (Apache 2.0 §4(a))', () => {
    show()
    const idbKeyval = screen.getByText('idb-keyval').closest('details')
    if (idbKeyval === null) throw new Error('idb-keyval has no notice')
    const paragraphs = [...idbKeyval.querySelectorAll('p')].map((p) => p.textContent ?? '')
    expect(paragraphs[0]).toBe('Copyright 2016, Jake Archibald')
    expect(paragraphs[1]).toMatch(/^Licensed under the Apache License, Version 2\.0/)
    const terms = paragraphs.indexOf('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(terms).toBeGreaterThan(1)
    expect(paragraphs.slice(terms - 3, terms)).toEqual(['Apache License', 'Version 2.0, January 2004', 'http://www.apache.org/licenses/'])
    expect(paragraphs).toContain('(a) You must give any other recipients of the Work or Derivative Works a copy of this License; and')
    expect(paragraphs.filter((p) => /^\d\. /.test(p)).map((p) => p.slice(0, 2))).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.'])
    expect(paragraphs.at(-1)).toBe('END OF TERMS AND CONDITIONS')
  })

  it('opens the erase sheet from About', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('button', { name: 'Erase all data' }))
    expect(useNav.getState().sheets.map((s) => s.route)).toEqual([{ name: 'erase' }])
  })
})
