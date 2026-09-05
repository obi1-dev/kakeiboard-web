import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ScanPage } from '../../src/client/pages/ScanPage'
import * as api from '../../src/client/lib/api'
import * as resizeModule from '../../src/client/lib/resizeImage'

vi.mock('../../src/client/lib/api')
vi.mock('../../src/client/lib/resizeImage')

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

describe('ScanPage', () => {
  it('runs OCR on the selected image and navigates to /confirm with the draft', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: 'pm1', name: '現金', created_at: '2026-01-01' },
    ])
    const file = new File(['bytes'], 'receipt.jpg', { type: 'image/jpeg' })
    vi.mocked(resizeModule.resizeImage).mockResolvedValue(file)
    const draft = {
      store_name: 'テスト店', purchased_at: '2026-09-01', receipt_total: 100,
      items: [], image_key: 'receipts/x.jpg',
    }
    vi.mocked(api.runOcr).mockResolvedValue(draft)
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ScanPage />
      </MemoryRouter>
    )

    const fileInput = await screen.findByLabelText('レシート画像')
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'スキャン開始' }))

    await waitFor(() => expect(api.runOcr).toHaveBeenCalled())
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/confirm', {
      state: { draft, paymentMethodId: 'pm1' },
    }))
  })
})
