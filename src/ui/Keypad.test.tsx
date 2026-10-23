import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeypadKey } from '@/domain/money'
import { Keypad } from '@/ui/Keypad'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

afterEach(cleanup)

describe('Keypad', () => {
  it('has a test id and a spoken name for every key', () => {
    render(<Keypad decimalSeparator="," onKey={() => {}} label="Amount keypad" />)
    const pad = screen.getByRole('group', { name: 'Amount keypad' })
    for (const digit of DIGITS) {
      const key = within(pad).getByTestId(`keypad-${digit}`)
      expect(key).toHaveAccessibleName(`Digit ${digit}`)
      expect(key).toHaveTextContent(digit)
    }
    expect(within(pad).getByTestId('keypad-dec')).toHaveAccessibleName('Decimal separator')
    expect(within(pad).getByTestId('keypad-back')).toHaveAccessibleName('Delete')
    // Twelve keys in four rows: 1–9, then separator, 0 and backspace.
    expect(within(pad).getAllByRole('button')).toHaveLength(12)
  })

  it('reports each key it is tapped with', async () => {
    const user = userEvent.setup()
    const keys: KeypadKey[] = []
    render(<Keypad decimalSeparator="," onKey={(key) => keys.push(key)} />)

    for (const id of ['1', '2', 'dec', '5', 'back', '0', '9']) await user.click(screen.getByTestId(`keypad-${id}`))
    expect(keys).toEqual(['1', '2', '.', '5', 'back', '0', '9'])
  })

  it("shows the locale's separator and sends '.' for both", async () => {
    const user = userEvent.setup()
    const onKey = vi.fn<(key: KeypadKey) => void>()
    const { rerender } = render(<Keypad decimalSeparator="," onKey={onKey} />)
    expect(screen.getByTestId('keypad-dec')).toHaveTextContent(',')

    rerender(<Keypad decimalSeparator="." onKey={onKey} />)
    expect(screen.getByTestId('keypad-dec')).toHaveTextContent('.')
    await user.click(screen.getByTestId('keypad-dec'))
    expect(onKey).toHaveBeenCalledWith('.')
  })

  it('has no decimal key for a currency without a minor unit', () => {
    render(<Keypad decimalSeparator={null} onKey={() => {}} />)
    expect(screen.queryByTestId('keypad-dec')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decimal separator' })).toBeNull()
    expect(screen.getByTestId('keypad-0')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(11)
  })

  it('puts the left key (Face ID) bottom left on the PIN pad, with no decimal key', async () => {
    const user = userEvent.setup()
    const onFaceId = vi.fn<() => void>()
    const onKey = vi.fn<(key: KeypadKey) => void>()
    render(
      <Keypad
        variant="pin"
        decimalSeparator=","
        label="PIN"
        onKey={onKey}
        leftKey={
          <button type="button" onClick={onFaceId}>
            Unlock with Face ID
          </button>
        }
      />,
    )
    const pad = screen.getByRole('group', { name: 'PIN' })
    expect(pad).toHaveAttribute('data-variant', 'pin')
    expect(within(pad).queryByTestId('keypad-dec')).toBeNull()

    await user.click(within(pad).getByRole('button', { name: 'Unlock with Face ID' }))
    expect(onFaceId).toHaveBeenCalledTimes(1)
    expect(onKey).not.toHaveBeenCalled()

    // The Face ID key sits before 0 and backspace in the last row, in reading order.
    const names = within(pad)
      .getAllByRole('button')
      .slice(-3)
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(names).toEqual(['Unlock with Face ID', 'Digit 0', 'Delete'])
  })

  it('takes no input while disabled (PIN lockout)', async () => {
    const user = userEvent.setup()
    const onKey = vi.fn<(key: KeypadKey) => void>()
    render(<Keypad variant="pin" decimalSeparator={null} onKey={onKey} disabled />)
    for (const digit of DIGITS) expect(screen.getByTestId(`keypad-${digit}`)).toBeDisabled()
    expect(screen.getByTestId('keypad-back')).toBeDisabled()
    await user.click(screen.getByTestId('keypad-5'))
    expect(onKey).not.toHaveBeenCalled()
  })

  it('shows a press while a finger is on a key, and lets go on release or cancel', () => {
    render(<Keypad decimalSeparator="," onKey={() => {}} />)
    const key = screen.getByTestId('keypad-7')
    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    expect(key).toHaveAttribute('data-pressed')
    key.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    expect(key).not.toHaveAttribute('data-pressed')

    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    key.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' }))
    expect(key).not.toHaveAttribute('data-pressed')
  })

  it('forwards its test id to the group', () => {
    render(<Keypad decimalSeparator="," onKey={() => {}} data-testid="amount-keypad" />)
    expect(screen.getByTestId('amount-keypad')).toHaveAttribute('data-variant', 'amount')
  })
})
