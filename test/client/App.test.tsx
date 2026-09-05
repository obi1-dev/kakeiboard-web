import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/client/App'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

describe('App', () => {
  it('renders the app navigation', () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([])
    render(
      <MemoryRouter initialEntries={['/scan']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'スキャン' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '履歴' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '支払い方法' })).toBeInTheDocument()
  })
})
