import { afterEach, describe, expect, it } from 'vitest'
import { createInitialData } from '@/domain/defaults'
import { sampleData } from '@/domain/test-helpers/dataFixtures'
import { getData, useAppStore } from '@/store/appStore'
import { useUiStore } from '@/store/uiStore'

afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
})

describe('useAppStore', () => {
  it('holds createInitialData(0) while loading', () => {
    expect(useAppStore.getState().status).toBe('loading')
    expect(getData()).toEqual(createInitialData(0))
  })

  it('getData returns the current data object', () => {
    const data = sampleData()
    useAppStore.setState({ data, status: 'ready' })
    expect(getData()).toBe(data)
  })
})

describe('useUiStore', () => {
  it('starts with nothing revealed and no system sheet, and sets both', () => {
    expect(useUiStore.getState()).toMatchObject({ amountsRevealed: false, systemSheetOpen: false })
    useUiStore.getState().setAmountsRevealed(true)
    useUiStore.getState().setSystemSheetOpen(true)
    expect(useUiStore.getState()).toMatchObject({ amountsRevealed: true, systemSheetOpen: true })
  })
})
