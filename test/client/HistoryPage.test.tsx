import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryPage } from '../../src/client/pages/HistoryPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

function renderHistoryPage() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/receipts/:id/edit" element={<p>編集ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const samplePaymentMethods = [
  { id: 'pm1', name: '現金', created_at: '2026-01-01' },
  { id: 'pm2', name: 'カードA', created_at: '2026-01-02' },
]

const sampleReceipts = [
  {
    id: 'r1', store_name: 'テストスーパー', purchased_at: '2026-09-01',
    payment_method_id: 'pm1', receipt_total: 200, image_key: 'k', created_at: '2026-09-01',
    items: [{ id: 'i1', receipt_id: 'r1', sort_order: 0, name: 'りんご', price: 100, quantity: 2, amount: 200, category: '食費' }],
  },
]

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue(samplePaymentMethods)
  })

  it('lists past receipts with their store name, payment method, and total', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)

    renderHistoryPage()

    expect(await screen.findByText('テストスーパー')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
    expect(await screen.findByText('現金')).toBeInTheDocument()
  })

  it('re-fetches with date filters when the filter form is submitted', async () => {
    // The date pickers default to the current month when no date is picked
    // yet, so pin "today" to make the visible calendar days deterministic.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-06'))
    try {
      vi.mocked(api.getReceipts).mockResolvedValue([])
      const user = userEvent.setup()

      renderHistoryPage()
      await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({}))

      await user.click(screen.getByLabelText('開始日'))
      await user.click(await screen.findByRole('button', { name: 'Tuesday, September 1st, 2026' }))
      await user.click(screen.getByLabelText('終了日'))
      await user.click(await screen.findByRole('button', { name: 'Wednesday, September 30th, 2026' }))
      await user.click(screen.getByRole('button', { name: '絞り込む' }))

      await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-fetches with store name and payment method filters when submitted', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue([])
    const user = userEvent.setup()

    renderHistoryPage()
    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({}))

    await user.type(screen.getByLabelText('店名'), 'テスト店')
    await user.click(screen.getByLabelText('支払い方法'))
    await user.click(await screen.findByRole('option', { name: 'カードA' }))
    await user.click(screen.getByRole('button', { name: '絞り込む' }))

    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({
      store_name: 'テスト店', payment_method_id: 'pm2',
    }))
  })

  it('deletes a receipt', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)
    vi.mocked(api.deleteReceipt).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    renderHistoryPage()

    await user.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(api.deleteReceipt).toHaveBeenCalledWith('r1'))
  })

  it('links each row to its edit page', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)

    renderHistoryPage()

    const editLink = await screen.findByRole('link', { name: '編集' })
    expect(editLink).toHaveAttribute('href', '/receipts/r1/edit')
  })

  it('renders a CSV download link using the current date filters', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue([])
    vi.mocked(api.exportCsvUrl).mockReturnValue('/api/export.csv?from=2026-09-01')

    renderHistoryPage()

    const link = await screen.findByRole('link', { name: 'CSVダウンロード' })
    expect(link).toHaveAttribute('href', '/api/export.csv?from=2026-09-01')
  })

  it('shows an error message when fetching receipts fails on filter', async () => {
    vi.mocked(api.getReceipts)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('取得に失敗しました'))
    const user = userEvent.setup()

    renderHistoryPage()
    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({}))

    await user.click(screen.getByRole('button', { name: '絞り込む' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取得に失敗しました')
  })

  it('shows an error message when deleting a receipt fails', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)
    vi.mocked(api.deleteReceipt).mockRejectedValue(new Error('削除に失敗しました'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    renderHistoryPage()

    await user.click(await screen.findByRole('button', { name: '削除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('削除に失敗しました')
  })
})
