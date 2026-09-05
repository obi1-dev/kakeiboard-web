import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { receiptsRoutes } from '../../src/api/receipts'

async function createPaymentMethod(name: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)'
  ).bind(id, name, new Date().toISOString()).run()
  return id
}

function samplePayload(paymentMethodId: string) {
  return {
    store_name: 'テストスーパー',
    purchased_at: '2026-09-01',
    payment_method_id: paymentMethodId,
    receipt_total: 300,
    image_key: 'receipts/test.jpg',
    items: [
      { name: 'りんご', price: 100, quantity: 2, category: '食費' },
      { name: 'ノート', price: 100, quantity: 1, category: '日用品' },
    ],
  }
}

describe('receipts API', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipt_items'),
      env.DB.prepare('DELETE FROM receipts'),
      env.DB.prepare('DELETE FROM payment_methods'),
    ])
  })

  it('creates a receipt with items and computes amount = price * quantity', async () => {
    const paymentMethodId = await createPaymentMethod('現金')

    const res = await receiptsRoutes.request('/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload(paymentMethodId)),
    }, env)
    expect(res.status).toBe(201)

    const detailRes = await receiptsRoutes.request(`/receipts/${(await res.json<{ id: string }>()).id}`, {}, env)
    const detail = await detailRes.json<{ items: { amount: number }[] }>()
    expect(detail.items).toHaveLength(2)
    expect(detail.items[0].amount).toBe(200)
    expect(detail.items[1].amount).toBe(100)
  })

  it('lists receipts filtered by date range and store name', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), purchased_at: '2026-08-01', store_name: '8月の店' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), purchased_at: '2026-09-01', store_name: '9月の店' }),
    }, env)

    const res = await receiptsRoutes.request('/receipts?from=2026-09-01&to=2026-09-30', {}, env)
    const list = await res.json<{ store_name: string }[]>()
    expect(list).toHaveLength(1)
    expect(list[0].store_name).toBe('9月の店')
  })

  it('updates a receipt and replaces its items', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    const createRes = await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload(paymentMethodId)),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const updateRes = await receiptsRoutes.request(`/receipts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...samplePayload(paymentMethodId),
        store_name: '更新後の店',
        items: [{ name: 'バナナ', price: 50, quantity: 3, category: '食費' }],
      }),
    }, env)
    expect(updateRes.status).toBe(200)

    const detailRes = await receiptsRoutes.request(`/receipts/${id}`, {}, env)
    const detail = await detailRes.json<{ store_name: string; items: { name: string; amount: number }[] }>()
    expect(detail.store_name).toBe('更新後の店')
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0]).toMatchObject({ name: 'バナナ', amount: 150 })
  })

  it('deletes a receipt, its items, and its R2 image', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    const imageKey = `receipts/${crypto.randomUUID()}.jpg`
    await env.RECEIPTS_BUCKET.put(imageKey, 'fake-bytes')

    const createRes = await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), image_key: imageKey }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const deleteRes = await receiptsRoutes.request(`/receipts/${id}`, { method: 'DELETE' }, env)
    expect(deleteRes.status).toBe(204)

    const detailRes = await receiptsRoutes.request(`/receipts/${id}`, {}, env)
    expect(detailRes.status).toBe(404)
    expect(await env.RECEIPTS_BUCKET.get(imageKey)).toBeNull()
  })

  it('lists receipts with correctly nested items via the LEFT JOIN query, including a receipt with no items', async () => {
    const paymentMethodId = await createPaymentMethod('現金')

    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...samplePayload(paymentMethodId),
        store_name: '店A', purchased_at: '2026-09-01',
        items: [
          { name: 'りんご', price: 100, quantity: 2, category: '食費' },
          { name: 'ノート', price: 100, quantity: 1, category: '日用品' },
        ],
      }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...samplePayload(paymentMethodId),
        store_name: '店B', purchased_at: '2026-09-02',
        items: [{ name: 'バナナ', price: 50, quantity: 3, category: '食費' }],
      }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...samplePayload(paymentMethodId),
        store_name: '店C', purchased_at: '2026-09-03',
        items: [],
      }),
    }, env)

    const res = await receiptsRoutes.request('/receipts', {}, env)
    expect(res.status).toBe(200)
    const list = await res.json<{ store_name: string; items: { name: string; amount: number }[] }[]>()
    expect(list).toHaveLength(3)

    const byStore = Object.fromEntries(list.map((r) => [r.store_name, r]))
    expect(byStore['店A'].items).toHaveLength(2)
    expect(byStore['店A'].items[0]).toMatchObject({ name: 'りんご', amount: 200 })
    expect(byStore['店A'].items[1]).toMatchObject({ name: 'ノート', amount: 100 })
    expect(byStore['店B'].items).toHaveLength(1)
    expect(byStore['店B'].items[0]).toMatchObject({ name: 'バナナ', amount: 150 })
    expect(byStore['店C'].items).toEqual([])

    // newest purchased_at first
    expect(list.map((r) => r.store_name)).toEqual(['店C', '店B', '店A'])
  })

  it('lists distinct store names for autocomplete', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店A' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店A' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店B' }),
    }, env)

    const res = await receiptsRoutes.request('/store-names', {}, env)
    expect((await res.json()).sort()).toEqual(['店A', '店B'])
  })
})
