import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TxKind } from '@/domain/types'
import { PaidCheck, type PaidCheckProps } from '@/ui/PaidCheck'
import styles from '@/ui/PaidCheck.module.css'
import { classOf } from '@/ui/testing/css'

// docs/DESIGN.md §9.8 and §10, docs/SPEC.md §3.5 and §9.

afterEach(cleanup)

/** The check with its state held, as a row holds it. */
function Harness({ initial, kind = 'expense', onToggle, ...rest }: { initial: boolean; kind?: TxKind; onToggle?(): void } & Pick<PaidCheckProps, 'data-testid' | 'data-id'>) {
  const [paid, setPaid] = useState(initial)
  return (
    <PaidCheck
      paid={paid}
      name="Netflix"
      kind={kind}
      onToggle={() => {
        onToggle?.()
        setPaid((value) => !value)
      }}
      {...rest}
    />
  )
}

describe('PaidCheck', () => {
  it('is a toggle button named for what a tap does, then for the state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn<() => void>()
    render(<Harness initial={false} onToggle={onToggle} />)
    const check = screen.getByRole('button', { name: 'Mark Netflix as paid' })
    expect(check).toHaveAttribute('aria-pressed', 'false')
    await user.click(check)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(check).toHaveAccessibleName('Netflix paid')
    expect(check).toHaveAttribute('aria-pressed', 'true')
  })

  it('says received for income', () => {
    const { unmount } = render(<Harness initial={false} kind="income" />)
    expect(screen.getByRole('button', { name: 'Mark Netflix as received' })).toBeInTheDocument()
    unmount()
    render(<Harness initial kind="income" />)
    expect(screen.getByRole('button', { name: 'Netflix received' })).toBeInTheDocument()
  })

  it('has the test id recurring-paid by default, and passes data-id through', () => {
    const { unmount } = render(<Harness initial={false} data-id="rec-netflix" />)
    const check = screen.getByTestId('recurring-paid')
    expect(check).toHaveAttribute('data-id', 'rec-netflix')
    unmount()
    render(<Harness initial={false} data-testid="upcoming-paid" />)
    expect(screen.getByTestId('upcoming-paid')).toBeInTheDocument()
  })

  it('stamps only a tick the user made, never a row that shows as paid', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial />)
    const shown = screen.getByRole('button', { name: 'Netflix paid' })
    expect(shown).toHaveClass(classOf(styles, 'paid'))
    expect(shown).not.toHaveClass(classOf(styles, 'stamp'))
    unmount()

    render(<Harness initial={false} />)
    const check = screen.getByRole('button', { name: 'Mark Netflix as paid' })
    expect(check).not.toHaveClass(classOf(styles, 'stamp'))
    await user.click(check)
    expect(check).toHaveClass(classOf(styles, 'stamp'))
    await user.click(check)
    expect(check).not.toHaveClass(classOf(styles, 'stamp'))
    expect(check).not.toHaveClass(classOf(styles, 'paid'))
  })
})
