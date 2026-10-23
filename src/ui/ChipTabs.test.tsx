import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipTabs, type ChipTabItem } from '@/ui/ChipTabs'

afterEach(cleanup)

type Filter = 'all' | 'transport' | 'eating' | 'coffee'

const ITEMS: ChipTabItem<Filter>[] = [
  { value: 'all', label: 'All' },
  { value: 'transport', label: 'Transport', icon: 'train' },
  { value: 'eating', label: 'Eating', icon: 'fork-knife' },
  { value: 'coffee', label: 'Coffee & snacks', icon: '☕' },
]

/** ChipTabs with its selection in state, as the Daily screen holds it. */
function Harness({ initial = 'all', onChange }: { initial?: Filter; onChange?(value: Filter): void }) {
  const [value, setValue] = useState<Filter>(initial)
  return (
    <ChipTabs
      items={ITEMS}
      value={value}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
      label="Categories"
      itemTestId="category-chip"
      data-testid="chips"
    />
  )
}

const selected = () => screen.getByRole('tab', { selected: true })

describe('ChipTabs', () => {
  it('is a tab list with one tab stop: the selected chip', () => {
    render(<Harness initial="eating" />)
    expect(screen.getByRole('tablist', { name: 'Categories' })).toHaveAttribute('data-testid', 'chips')
    const tabs = screen.getAllByRole('tab')
    // Named by their labels alone: glyphs and emoji are decorative.
    const names = ['All', 'Transport', 'Eating', 'Coffee & snacks']
    expect(tabs).toEqual(names.map((name) => screen.getByRole('tab', { name })))
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1])
    expect(selected()).toHaveTextContent('Eating')
  })

  it('marks every chip with the item test id and its value as data-id', () => {
    render(<Harness />)
    const chips = screen.getAllByTestId('category-chip')
    expect(chips.map((chip) => chip.dataset.id)).toEqual(['all', 'transport', 'eating', 'coffee'])
  })

  it('selects the next and previous chip with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Filter) => void>()
    render(<Harness onChange={onChange} />)
    await user.tab()
    expect(selected()).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('transport')
    expect(selected()).toHaveTextContent('Transport')
    expect(selected()).toHaveFocus()

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(selected()).toHaveTextContent('Coffee & snacks')
    expect(selected()).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(selected()).toHaveTextContent('All')
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('jumps to the first and last chip with Home and End', async () => {
    const user = userEvent.setup()
    render(<Harness initial="transport" />)
    await user.tab()
    await user.keyboard('{End}')
    expect(selected()).toHaveTextContent('Coffee & snacks')
    expect(selected()).toHaveFocus()
    await user.keyboard('{Home}')
    expect(selected()).toHaveTextContent('All')
    expect(selected()).toHaveFocus()
  })

  it('moves the tab stop with the selection, so Tab leaves the list', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <button type="button">After</button>
      </>,
    )
    await user.tab()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1])
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('ignores other keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Filter) => void>()
    render(<Harness onChange={onChange} />)
    await user.tab()
    await user.keyboard('a{ArrowUp}{ArrowDown}')
    expect(onChange).not.toHaveBeenCalled()
    expect(selected()).toHaveTextContent('All')
  })

  it('selects a chip on tap', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Filter) => void>()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('tab', { name: 'Coffee & snacks' }))
    expect(onChange).toHaveBeenCalledWith('coffee')
    expect(selected()).toHaveTextContent('Coffee & snacks')
  })

  it('keeps one tab stop when no chip is selected', () => {
    render(<ChipTabs items={ITEMS} value={'missing' as Filter} onChange={() => {}} label="Categories" />)
    expect(screen.queryByRole('tab', { selected: true })).toBeNull()
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
  })
})
