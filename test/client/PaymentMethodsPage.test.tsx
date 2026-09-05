import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentMethodsPage } from '../../src/client/pages/PaymentMethodsPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

describe('PaymentMethodsPage', () => {
  it('lists existing payment methods', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: '1', name: '現金', created_at: '2026-01-01' },
      { id: '2', name: 'カードA', created_at: '2026-01-02' },
    ])

    render(<PaymentMethodsPage />)

    expect(await screen.findByText('現金')).toBeInTheDocument()
    expect(screen.getByText('カードA')).toBeInTheDocument()
  })

  it('adds a new payment method', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([])
    vi.mocked(api.createPaymentMethod).mockResolvedValue({ id: '3', name: 'カードB', created_at: '2026-01-03' })
    const user = userEvent.setup()

    render(<PaymentMethodsPage />)

    await user.click(await screen.findByRole('button', { name: '追加' }))
    await user.type(screen.getByLabelText('名前'), 'カードB')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.createPaymentMethod).toHaveBeenCalledWith('カードB'))
  })

  it('deletes a payment method', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: '1', name: '現金', created_at: '2026-01-01' },
    ])
    vi.mocked(api.deletePaymentMethod).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<PaymentMethodsPage />)

    await user.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(api.deletePaymentMethod).toHaveBeenCalledWith('1'))
  })
})
