import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SheetRoute } from '@/app/nav'
import { GoalSheet } from '@/features/wallet/GoalSheet'
import { BIKE, JACKET, JAPAN, walletData } from '@/features/wallet/testData'
import { endTest, plain, renderWithApp, startTest } from '@/features/wallet/testUtils'
import { getData } from '@/store/appStore'
import { currentToast } from '@/ui/toast'

beforeEach(() => startTest(walletData()))

afterEach(() => {
  cleanup()
  endTest()
})

function renderSheet(route: Extract<SheetRoute, { name: 'goal' }>) {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  renderWithApp(<GoalSheet route={route} onClose={onClose} setDirty={setDirty} />)
  return { onClose, setDirty }
}

describe('a new goal (SPEC §3.14)', () => {
  it('is added once it has a name and a target, with the piggy bank, at the end of the fill order', async () => {
    const user = userEvent.setup()
    const { onClose, setDirty } = renderSheet({ name: 'goal' })
    expect(screen.getByRole('heading', { name: 'New goal' })).toBeInTheDocument()
    expect(screen.getByText('New goals fill last. Move them up on the Wallet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete goal' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Icon, Piggy bank' })).toBeInTheDocument()
    const add = screen.getByTestId('sheet-save')
    expect(add).toHaveTextContent('Add')
    expect(add).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Camera')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    expect(add).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Target' }), '450')
    expect(add).toBeEnabled()
    await user.click(add)
    expect(onClose).toHaveBeenCalledOnce()
    const camera = getData().wallet.goals.at(-1)
    expect(camera).toMatchObject({ name: 'Camera', icon: 'piggy-bank', target: 45000, doneAt: null })
    expect(camera?.order).toBeGreaterThan(BIKE.order)
  })

  it('keeps names to 24 characters and needs a target above zero', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'goal' })
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('maxLength', '24')
    await user.type(name, 'Bike')
    await user.type(screen.getByRole('textbox', { name: 'Target' }), '0')
    expect(screen.getByText(/The target must be above 0,00\s€\. Enter a larger amount\./)).toBeInTheDocument()
    expect(screen.getByTestId('sheet-save')).toBeDisabled()
  })
})

describe('an existing goal', () => {
  it('shows its name, icon, target and what it holds, and saves changes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'goal', id: JAPAN.id })
    expect(screen.getByRole('heading', { name: 'Japan trip' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Japan trip')
    expect(screen.getByRole('button', { name: 'Icon, Aeroplane' })).toBeInTheDocument()
    expect(plain(screen.getByText(/is set aside for it so far/).textContent)).toBe(
      '1.450,00 € is set aside for it so far. It fills first, before New bike.',
    )
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Tokyo')
    await user.click(screen.getByTestId('sheet-save'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.goals.find((goal) => goal.id === JAPAN.id)).toMatchObject({ name: 'Tokyo', target: 200000 })
  })

  it('is marked as done through Undo, keeping edits made just before', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'goal', id: BIKE.id })
    expect(screen.getByText('For when you have reached it or bought it. It stops taking money and moves to Done.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.goals.find((goal) => goal.id === BIKE.id)?.doneAt).not.toBeNull()
    await waitFor(() => expect(currentToast()?.message).toBe('Marked New bike as done'))
    act(() => currentToast()?.action?.onClick())
    expect(getData().wallet.goals.find((goal) => goal.id === BIKE.id)?.doneAt).toBeNull()
  })

  it('is deleted without a question, with Undo', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'goal', id: JAPAN.id })
    await user.click(screen.getByRole('button', { name: 'Delete goal' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.goals.map((goal) => goal.id)).toEqual([JACKET.id, BIKE.id])
    await waitFor(() => expect(currentToast()?.message).toBe('Deleted Japan trip'))
    act(() => currentToast()?.action?.onClick())
    expect(getData().wallet.goals.map((goal) => goal.id)).toEqual([JACKET.id, JAPAN.id, BIKE.id])
  })

  it('offers "Put back" for a done goal', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'goal', id: JACKET.id })
    expect(screen.getByText(/^Done on 3 Oct\. It takes no money until you put it back\.$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Put back' }))
    expect(getData().wallet.goals.find((goal) => goal.id === JACKET.id)?.doneAt).toBeNull()
  })

  it('says so when the goal is gone', () => {
    renderSheet({ name: 'goal', id: 'goal-missing' })
    expect(screen.getByText('This goal was deleted')).toBeInTheDocument()
  })
})

describe('the icon (IconPicker in the sheet)', () => {
  it('picks an icon in its own view; Done keeps it and Cancel puts the old one back', async () => {
    const user = userEvent.setup()
    const { setDirty } = renderSheet({ name: 'goal', id: JAPAN.id })
    await user.click(screen.getByRole('button', { name: 'Icon, Aeroplane' }))
    expect(screen.getByRole('heading', { name: 'Icon' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Aeroplane' })).toHaveFocus()

    await user.click(screen.getByRole('radio', { name: 'Suitcase' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Icon, Aeroplane' })).toHaveFocus()
    expect(setDirty).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Icon, Aeroplane' }))
    await user.click(screen.getByRole('radio', { name: 'Suitcase' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Icon, Suitcase' })).toHaveFocus()
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().wallet.goals.find((goal) => goal.id === JAPAN.id)?.icon).toBe('suitcase-rolling')
    // The picker draws 64 glyphs and many clicks: allow for a busy machine.
  }, 20_000)
})
