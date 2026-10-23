import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyState } from '@/ui/EmptyState'
import { cssRule, readSibling } from '@/ui/testing/css'

// docs/DESIGN.md §9.20.

afterEach(cleanup)

describe('EmptyState', () => {
  it('shows its title as a heading and the message under it', () => {
    render(<EmptyState title="Your wallet fills up when a month closes" message="What you don't spend goes here." />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Your wallet fills up when a month closes')
    expect(screen.getByText("What you don't spend goes here.")).toBeInTheDocument()
  })

  it('balances the lines of its title and message', () => {
    const css = readSibling(import.meta.url, 'EmptyState.module.css')
    expect(cssRule(css, '.title')['text-wrap']).toBe('balance')
    expect(cssRule(css, '.message')['text-wrap']).toBe('balance')
  })
})
