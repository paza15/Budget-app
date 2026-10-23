import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATEGORY_ICONS, type CategoryIconOption } from '@/domain/catalog'
import type { IconRef } from '@/domain/types'
import { IconPicker, typedEmoji } from '@/ui/IconPicker'
import { emojiFromInput, firstGrapheme } from '@/ui/text'

afterEach(cleanup)

const EMOJIS = ['☕', '🍕', '🥐', '🚲']

const ICONS: CategoryIconOption[] = CATEGORY_ICONS.filter((icon) =>
  ['fork-knife', 'coffee', 'shopping-cart', 'train', 'bus'].includes(icon.key),
)

/** The picker with its value in state, as the category sheet holds it. */
function Harness({ initial, onChange }: { initial: IconRef; onChange?(value: IconRef): void }) {
  const [value, setValue] = useState<IconRef>(initial)
  return (
    <>
      <IconPicker
        value={value}
        onChange={(next) => {
          onChange?.(next)
          setValue(next)
        }}
        icons={ICONS}
        emojis={EMOJIS}
        data-testid="picker"
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('the emoji input rule', () => {
  it('keeps the first grapheme of what was typed or pasted', () => {
    expect(emojiFromInput('😀abc')).toBe('😀')
    expect(emojiFromInput('🦊🐻')).toBe('🦊')
    expect(emojiFromInput('  🥐')).toBe('🥐')
  })

  it('keeps whole graphemes: skin tones, flags and families', () => {
    expect(emojiFromInput('👍🏽 nice')).toBe('👍🏽')
    expect(emojiFromInput('🇩🇪')).toBe('🇩🇪')
    expect(emojiFromInput('👩‍👩‍👧')).toBe('👩‍👩‍👧')
    expect(emojiFromInput('❤️')).toBe('❤️')
    expect(firstGrapheme('👩‍👩‍👧x')).toBe('👩‍👩‍👧')
  })

  it('rejects letters and digits, also inside a grapheme', () => {
    expect(emojiFromInput('a')).toBeNull()
    expect(emojiFromInput('é')).toBeNull()
    expect(emojiFromInput('7')).toBeNull()
    expect(emojiFromInput('1️⃣')).toBeNull()
    expect(emojiFromInput('a😀')).toBeNull()
  })

  it('rejects what is not an emoji at all', () => {
    expect(emojiFromInput('')).toBeNull()
    expect(emojiFromInput('   ')).toBeNull()
    expect(emojiFromInput('€')).toBeNull()
    expect(emojiFromInput('#️⃣')).toBeNull()
    expect(emojiFromInput('🏽')).toBeNull()
  })

  it('replaces the emoji in the field with the next one typed after it', () => {
    expect(typedEmoji('😀🎉', '😀')).toBe('🎉')
    expect(typedEmoji('🎉😀', '😀')).toBe('🎉')
    expect(typedEmoji('😀a', '😀')).toBeNull()
    expect(typedEmoji('🦊', '')).toBe('🦊')
  })

  it('keeps a skin tone that joins the emoji already in the field', () => {
    expect(typedEmoji('👍🏽', '👍')).toBe('👍🏽')
  })
})

describe('IconPicker', () => {
  it('opens on the tab of the current symbol', () => {
    render(<Harness initial="coffee" />)
    expect(screen.getByRole('radio', { name: 'Icons' })).toBeChecked()
    cleanup()
    render(<Harness initial="🥐" />)
    expect(screen.getByRole('radio', { name: 'Emoji' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '🥐' })).toBeChecked()
  })

  it('picks an icon and checks it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: IconRef) => void>()
    render(<Harness initial="coffee" onChange={onChange} />)
    const icons = screen.getByRole('radiogroup', { name: 'Icon' })
    const coffee = ICONS.find((icon) => icon.key === 'coffee')
    expect(within(icons).getByRole('radio', { name: coffee?.name })).toBeChecked()

    const train = ICONS.find((icon) => icon.key === 'train')
    await user.click(within(icons).getByRole('radio', { name: train?.name }))
    expect(onChange).toHaveBeenCalledWith('train')
    expect(within(icons).getByRole('radio', { name: train?.name })).toBeChecked()
  })

  it('filters the icons by name and keywords', async () => {
    const user = userEvent.setup()
    render(<Harness initial="coffee" />)
    await user.type(screen.getByRole('searchbox', { name: 'Search icons' }), 'bus')
    const icons = screen.getByRole('radiogroup', { name: 'Icon' })
    expect(within(icons).getAllByRole('radio')).toHaveLength(1)
    await user.clear(screen.getByRole('searchbox', { name: 'Search icons' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search icons' }), 'zzz')
    expect(within(icons).queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText(/No icon matches/, { selector: 'output' })).toBeInTheDocument()
  })

  it('keeps the first grapheme of a pasted emoji', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: IconRef) => void>()
    render(<Harness initial="coffee" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: 'Emoji' }))
    const field = screen.getByRole('textbox', { name: 'Emoji' })
    await user.click(field)
    await user.paste('🦊 and more')
    expect(onChange).toHaveBeenLastCalledWith('🦊')
    expect(field).toHaveValue('🦊')
    expect(screen.getByTestId('value')).toHaveTextContent('🦊')
  })

  it('rejects letters and digits, says why and keeps the field as it was', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: IconRef) => void>()
    render(<Harness initial="🦊" onChange={onChange} />)
    const field = screen.getByRole('textbox', { name: 'Emoji' })
    expect(field).toHaveValue('🦊')

    await user.type(field, 'a')
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue('🦊')
    expect(field).toHaveAccessibleDescription('Only an emoji works here, not letters or numbers.')

    await user.click(field)
    await user.paste('🐻')
    expect(onChange).toHaveBeenLastCalledWith('🐻')
    expect(field).toHaveValue('🐻')
    expect(field).not.toHaveAccessibleDescription()
  })

  it('shows a chosen suggestion in the grid, not in the field', async () => {
    const user = userEvent.setup()
    render(<Harness initial="🦊" />)
    await user.click(screen.getByRole('radio', { name: '🍕' }))
    expect(screen.getByRole('radio', { name: '🍕' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Emoji' })).toHaveValue('')
  })

  it('clears the field without changing the symbol', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: IconRef) => void>()
    render(<Harness initial="🦊" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Clear emoji' }))
    expect(screen.getByRole('textbox', { name: 'Emoji' })).toHaveValue('')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('value')).toHaveTextContent('🦊')
  })
})
