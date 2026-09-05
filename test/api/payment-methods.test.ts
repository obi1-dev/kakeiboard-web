import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { paymentMethodsRoutes } from '../../src/api/payment-methods'

describe('payment methods API', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipt_items'),
      env.DB.prepare('DELETE FROM receipts'),
      env.DB.prepare('DELETE FROM payment_methods'),
    ])
  })

  it('creates and lists payment methods', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '現金' }),
    }, env)
    expect(createRes.status).toBe(201)
    const created = await createRes.json<{ id: string; name: string }>()
    expect(created.name).toBe('現金')

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    const list = await listRes.json<{ name: string }[]>()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('現金')
  })

  it('rejects an empty name', async () => {
    const res = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('updates a payment method name', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA' }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const updateRes = await paymentMethodsRoutes.request(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA改' }),
    }, env)
    expect(updateRes.status).toBe(200)

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    const list = await listRes.json<{ name: string }[]>()
    expect(list[0].name).toBe('カードA改')
  })

  it('returns 404 when updating an unknown id', async () => {
    const res = await paymentMethodsRoutes.request('/does-not-exist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    }, env)
    expect(res.status).toBe(404)
  })

  it('deletes a payment method', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '削除対象' }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const deleteRes = await paymentMethodsRoutes.request(`/${id}`, { method: 'DELETE' }, env)
    expect(deleteRes.status).toBe(204)

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    expect(await listRes.json()).toEqual([])
  })

  it('returns 409 when deleting a payment method still referenced by a receipt', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '使用中のカード' }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const receiptId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO receipts (id, store_name, purchased_at, payment_method_id, receipt_total, image_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(receiptId, 'テストスーパー', '2026-09-01', id, 100, 'receipts/test.jpg', new Date().toISOString()).run()

    const deleteRes = await paymentMethodsRoutes.request(`/${id}`, { method: 'DELETE' }, env)
    expect(deleteRes.status).toBe(409)
    const body = await deleteRes.json<{ error: string }>()
    expect(body.error).toBe('この支払い方法はレシートで使用されているため削除できません')

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    const list = await listRes.json<{ id: string }[]>()
    expect(list.some((m) => m.id === id)).toBe(true)
  })
})
