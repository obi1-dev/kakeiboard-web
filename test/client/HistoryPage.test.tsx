import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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

const sampleReceipts = [
  {
    id: 'r1', store_name: 'テストスーパー', purchased_at: '2026-09-01',
    payment_method_id: 'pm1', receipt_total: 200, image_key: 'k', created_at: '2026-09-01',
    items: [{ id: 'i1', receipt_id: 'r1', sort_order: 0, name: 'りんご', price: 100, quantity: 2, amount: 200, category: '食費' }],
  },
]

describe('HistoryPage', () => {
  it('lists past receipts with their store name and total', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)

    renderHistoryPage()

    expect(await screen.findByText('テストスーパー')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
  })

  it('re-fetches with date filters when the filter form is submitted', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue([])
    const user = userEvent.setup()

    renderHistoryPage()
    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({}))

    await user.type(screen.getByLabelText('開始日'), '2026-09-01')
    await user.type(screen.getByLabelText('終了日'), '2026-09-30')
    await user.click(screen.getByRole('button', { name: '絞り込む' }))

    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }))
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
})
