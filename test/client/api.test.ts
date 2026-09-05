import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPaymentMethod, deleteReceipt, exportCsvUrl, getPaymentMethods, getReceipts, saveReceipt,
} from '../../src/client/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('getPaymentMethods calls GET /api/payment-methods and returns json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: '1', name: '現金' }] })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPaymentMethods()

    expect(fetchMock).toHaveBeenCalledWith('/api/payment-methods', undefined)
    expect(result).toEqual([{ id: '1', name: '現金' }])
  })

  it('createPaymentMethod POSTs the name as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '1', name: 'カードA' }) })
    vi.stubGlobal('fetch', fetchMock)

    await createPaymentMethod('カードA')

    expect(fetchMock).toHaveBeenCalledWith('/api/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA' }),
    })
  })

  it('saveReceipt POSTs to /api/receipts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      store_name: '店', purchased_at: '2026-09-01', payment_method_id: 'pm1',
      receipt_total: 100, image_key: 'k', items: [],
    }

    await saveReceipt(payload)

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('getReceipts builds a query string from filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    await getReceipts({ from: '2026-09-01', to: '2026-09-30' })

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts?from=2026-09-01&to=2026-09-30', undefined)
  })

  it('deleteReceipt calls DELETE on the receipt id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await deleteReceipt('r1')

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts/r1', { method: 'DELETE' })
  })

  it('exportCsvUrl builds the download URL with date range', () => {
    expect(exportCsvUrl('2026-09-01', '2026-09-30')).toBe('/api/export.csv?from=2026-09-01&to=2026-09-30')
    expect(exportCsvUrl()).toBe('/api/export.csv')
  })
})
