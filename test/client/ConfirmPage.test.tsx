import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmPage } from '../../src/client/pages/ConfirmPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

const draft = {
  store_name: 'テストスーパー',
  purchased_at: '2026-09-01',
  receipt_total: 300,
  image_key: 'receipts/x.jpg',
  items: [
    { name: 'りんご', price: 100, quantity: 2, category: '食費' },
  ],
}

function renderConfirmPage() {
  vi.mocked(api.getStoreNames).mockResolvedValue(['テストスーパー', '別の店'])
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/confirm', state: { draft, paymentMethodId: 'pm1' } }]}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
        <Route path="/history" element={<p>履歴ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderConfirmPageInEditMode() {
  vi.mocked(api.getStoreNames).mockResolvedValue(['テストスーパー'])
  vi.mocked(api.getReceipt).mockResolvedValue({
    id: 'r1', store_name: 'テストスーパー', purchased_at: '2026-09-01',
    payment_method_id: 'pm1', receipt_total: 300, image_key: 'receipts/x.jpg', created_at: '2026-09-01',
    items: [{ id: 'i1', receipt_id: 'r1', sort_order: 0, name: 'りんご', price: 100, quantity: 2, amount: 200, category: '食費' }],
  })
  return render(
    <MemoryRouter initialEntries={['/receipts/r1/edit']}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
        <Route path="/history" element={<p>履歴ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConfirmPage', () => {
  it('shows a mismatch warning when items total differs from the OCR receipt total', async () => {
    renderConfirmPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/一致しません/)
  })

  it('adds a new item row', async () => {
    const user = userEvent.setup()
    renderConfirmPage()

    await user.click(await screen.findByRole('button', { name: '行を追加' }))

    const nameInputs = screen.getAllByLabelText('品名')
    expect(nameInputs).toHaveLength(2)
  })

  it('removes an item row', async () => {
    const user = userEvent.setup()
    renderConfirmPage()

    await screen.findByLabelText('品名')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(screen.queryAllByLabelText('品名')).toHaveLength(0)
  })

  it('saves the receipt and navigates to /history', async () => {
    vi.mocked(api.saveReceipt).mockResolvedValue({ id: 'r1' })
    const user = userEvent.setup()
    renderConfirmPage()

    await screen.findByLabelText('品名')
    await user.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({
      store_name: 'テストスーパー',
      payment_method_id: 'pm1',
      image_key: 'receipts/x.jpg',
      items: [{ name: 'りんご', price: 100, quantity: 2, category: '食費' }],
    })))
    expect(await screen.findByText('履歴ページ')).toBeInTheDocument()
  })

  it('loads an existing receipt in edit mode and calls updateReceipt on save', async () => {
    vi.mocked(api.updateReceipt).mockResolvedValue({ id: 'r1' })
    const user = userEvent.setup()
    renderConfirmPageInEditMode()

    expect(await screen.findByDisplayValue('テストスーパー')).toBeInTheDocument()
    expect(await screen.findByLabelText('品名')).toHaveValue('りんご')

    await user.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.updateReceipt).toHaveBeenCalledWith('r1', expect.objectContaining({
      store_name: 'テストスーパー',
      payment_method_id: 'pm1',
      items: [{ name: 'りんご', price: 100, quantity: 2, category: '食費' }],
    })))
    expect(await screen.findByText('履歴ページ')).toBeInTheDocument()
  })
})
