import { render, screen } from '@testing-library/react'
import { get, set } from 'idb-keyval'
import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('renders React into jsdom with jest-dom matchers', () => {
    render(<p>On a Budget</p>)
    expect(screen.getByText('On a Budget')).toBeInTheDocument()
  })

  it('has a working fake IndexedDB', async () => {
    await set('k', { a: 1 })
    expect(await get('k')).toEqual({ a: 1 })
  })
})
