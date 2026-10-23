import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Monogram } from '@/ui/Monogram'

// docs/DESIGN.md §9.9, docs/design/EXTRAS.md §3.1 and §5.

afterEach(cleanup)

/** The glyphs drawn in the medallion: every svg except the engraved rim. */
function glyphs(root: Element): SVGSVGElement[] {
  return [...root.querySelectorAll<SVGSVGElement>('svg[data-icon]')]
}

describe('Monogram', () => {
  it('draws the light person glyph without a name or an emoji, sized to the medallion', () => {
    const sizes = { sm: '13', md: '16', lg: '28' } as const
    for (const [size, px] of Object.entries(sizes)) {
      const { container, unmount } = render(<Monogram name="  " avatar="" size={size as keyof typeof sizes} />)
      const medal = container.firstElementChild as HTMLElement
      const drawn = glyphs(medal)
      expect(drawn).toHaveLength(1)
      expect(drawn[0]).toHaveAttribute('data-icon', 'person')
      expect(drawn[0]).toHaveAttribute('width', px)
      expect(drawn[0]).toHaveAttribute('height', px)
      expect(medal).toHaveTextContent('')
      unmount()
    }
  })

  it('shows the initial of the name instead', () => {
    const { container } = render(<Monogram name="alex" avatar="" />)
    const medal = container.firstElementChild as HTMLElement
    expect(medal).toHaveTextContent('A')
    expect(glyphs(medal)).toHaveLength(0)
  })

  it('shows the emoji instead of the initial or the glyph', () => {
    const { container } = render(<Monogram name="" avatar="🦊" size="lg" />)
    const medal = container.firstElementChild as HTMLElement
    expect(medal).toHaveTextContent('🦊')
    expect(glyphs(medal)).toHaveLength(0)
  })

  it('is decoration: the button or row beside it carries the name', () => {
    const { container } = render(<Monogram name="" avatar="" data-testid="monogram" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstElementChild).toHaveAttribute('data-testid', 'monogram')
  })
})
