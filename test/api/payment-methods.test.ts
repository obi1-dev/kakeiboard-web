import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { paymentMethodsRoutes } from '../../src/api/payment-methods'

describe('payment methods API', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM payment_methods').run()
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
})
