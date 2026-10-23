import { cleanup, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Screen } from '@/ui/Screen'
import styles from '@/ui/Screen.module.css'
import { classOf, cssRule, px, readSibling } from '@/ui/testing/css'

// docs/DESIGN.md §9.2 (header) and §9.19 (banners in the content flow under it).

afterEach(cleanup)

const css = readSibling(import.meta.url, 'Screen.module.css')

function slotIn(container: HTMLElement): HTMLElement {
  const slot = container.querySelector<HTMLElement>('[data-banner-slot]')
  if (slot === null) throw new Error('The Screen has no banner slot')
  return slot
}

/** True when `a` comes before `b` in the document. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('Screen', () => {
  it('is a region named by its title, with the title as its heading', () => {
    render(
      <Screen title="Coffee & snacks">
        <p>Content</p>
      </Screen>,
    )
    expect(screen.getByRole('region', { name: 'Coffee & snacks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Coffee & snacks' })).toBeInTheDocument()
  })

  describe('focus (VoiceOver moves to a new screen)', () => {
    it('lets every heading it renders take focus from script, outside the tab order', () => {
      const variants = [
        <Screen key="large" title="Daily" largeTitle />,
        <Screen key="content" title="October" titleContent={<span>October</span>} largeTitle />,
        <Screen key="centred" title="Owed to you" onBack={() => {}} />,
      ]
      for (const variant of variants) {
        const { unmount } = render(variant)
        expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('tabindex', '-1')
        unmount()
      }
    })

    it('shows no focus ring on its headings unless the focus is visible', () => {
      expect(cssRule(css, '.focusTarget:focus:not(:focus-visible)')).toEqual({ outline: 'none' })
    })

    it('focuses its heading on mount with focusTitle, and not without', () => {
      const { unmount } = render(<Screen title="Your name" largeTitle />)
      expect(document.activeElement).toBe(document.body)
      unmount()
      render(<Screen title="Your name" largeTitle focusTitle />)
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Your name' }))
    })

    it('focuses the hidden heading beside titleContent and the centred title too', () => {
      const { unmount } = render(<Screen title="October" titleContent={<span>Oct</span>} largeTitle focusTitle />)
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'October' }))
      unmount()
      render(<Screen title="Owed to you" onBack={() => {}} focusTitle />)
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Owed to you' }))
    })
  })

  describe('nav row (DESIGN.md §9.2)', () => {
    it('takes the hidden compact title out of the row, so the leading side gives way first', () => {
      render(<Screen title="Fixed" titleContent={<span>October</span>} largeTitle eyebrow="Fixed costs and income" />)
      expect(screen.getByRole('banner')).toHaveClass(classOf(styles, 'titleHidden'))
      expect(cssRule(css, '.titleHidden')['grid-template-columns']).toBe('minmax(0, 1fr) auto max-content')
      expect(cssRule(css, '.titleHidden > .center').position).toBe('absolute')
      // The leading side fills its column, so the eyebrow ellipsis starts at the column's end.
      expect(cssRule(css, '.titleHidden > .leading')['justify-self']).toBe('stretch')
      // Leading and trailing keep their columns while the centre leaves the flow.
      expect(cssRule(css, '.leading')['grid-column']).toBe('1')
      expect(cssRule(css, '.trailing')['grid-column']).toBe('3')
    })

    it('keeps equal sides for a centred title that always shows', () => {
      render(<Screen title="Owed to you" onBack={() => {}} headerRight={<button type="button">Add</button>} />)
      expect(screen.getByRole('banner')).not.toHaveClass(classOf(styles, 'titleHidden'))
      expect(cssRule(css, '.nav')['grid-template-columns']).toBe('minmax(max-content, 1fr) auto minmax(max-content, 1fr)')
    })

    it('ends a long eyebrow in an ellipsis instead of overflowing', () => {
      expect(cssRule(css, '.eyebrow')).toMatchObject({
        'min-width': '0',
        overflow: 'hidden',
        'white-space': 'nowrap',
        'text-overflow': 'ellipsis',
      })
    })
  })

  describe('banner slot (src/app/AppBanners.tsx)', () => {
    it('sits in the scroll container after the nav and title rows, before the content, and starts empty', () => {
      const { container } = render(
        <Screen title="October" titleContent={<span>October</span>} largeTitle>
          <p>Content</p>
        </Screen>,
      )
      const slot = slotIn(container)
      expect(slot).toBeEmptyDOMElement()
      expect(container.querySelectorAll('[data-banner-slot]')).toHaveLength(1)
      const nav = screen.getByRole('banner')
      const title = screen.getByRole('heading', { level: 1, name: 'October' })
      const content = screen.getByText('Content')
      // The nav row, the slot and the content share the scroll container.
      expect(slot.parentElement).toBe(nav.parentElement)
      expect(precedes(nav, slot)).toBe(true)
      expect(precedes(title, slot)).toBe(true)
      expect(precedes(slot, content)).toBe(true)
    })

    it('is there on screens without a title row too', () => {
      const { container } = render(
        <Screen title="Owed to you" onBack={() => {}} backLabel="Home">
          <p>Content</p>
        </Screen>,
      )
      const slot = slotIn(container)
      expect(precedes(screen.getByRole('banner'), slot)).toBe(true)
      expect(precedes(slot, screen.getByText('Content'))).toBe(true)
    })

    it('keeps what the shell portals into it across re-renders of the screen', () => {
      const target = { slot: null as HTMLElement | null }
      const view = (
        <Screen title="Daily" largeTitle>
          <p>Content</p>
        </Screen>
      )
      const { container, rerender } = render(view)
      target.slot = slotIn(container)
      const portal = render(createPortal(<p>A new version of On a Budget is ready.</p>, target.slot))
      rerender(
        <Screen title="Daily" largeTitle eyebrow="Daily spending">
          <p>Content</p>
        </Screen>,
      )
      expect(slotIn(container)).toBe(target.slot)
      expect(target.slot).toHaveTextContent('A new version of On a Budget is ready.')
      portal.unmount()
      expect(target.slot).toBeEmptyDOMElement()
    })

    it('goes between the nav row and the title row with bannerSlot beforeTitle', () => {
      const { container } = render(
        <Screen title="Wallet" titleContent={<span>1.240,00 €</span>} largeTitle bannerSlot="beforeTitle">
          <p>Content</p>
        </Screen>,
      )
      const slot = slotIn(container)
      expect(container.querySelectorAll('[data-banner-slot]')).toHaveLength(1)
      expect(precedes(screen.getByRole('banner'), slot)).toBe(true)
      expect(precedes(slot, screen.getByRole('heading', { level: 1, name: 'Wallet' }))).toBe(true)
      expect(precedes(slot, screen.getByText('1.240,00 €'))).toBe(true)
    })

    it('stacks banners with margins, not a gap, so a collapsing banner takes its spacing with it', () => {
      expect(cssRule(css, '.bannerSlot').gap).toBeUndefined()
      expect(px(cssRule(css, '.bannerSlot > * + *')['margin-top'])).toBe(10)
      expect(px(cssRule(css, '.bannerSlot > :first-child')['margin-top'])).toBe(2)
      expect(px(cssRule(css, '.bannerSlot > :last-child')['margin-bottom'])).toBe(6)
    })
  })
})
