import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportRoutes, rowsToCsv } from '../../src/api/export'
import { receiptsRoutes } from '../../src/api/receipts'

describe('rowsToCsv', () => {
  it('formats rows with header and escapes commas/quotes', () => {
    const csv = rowsToCsv([
      { purchased_at: '2026-09-01', store_name: 'スーパー, A', payment_method: '現金', item_name: 'りんご"3個"', unit_price: 100, quantity: 2, amount: 200, category: '食費' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('purchased_at,store_name,payment_method,item_name,unit_price,quantity,amount,category')
    expect(lines[1]).toBe('2026-09-01,"スーパー, A",現金,"りんご""3個""",100,2,200,食費')
  })
})

describe('GET /export.csv', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipt_items'),
      env.DB.prepare('DELETE FROM receipts'),
      env.DB.prepare('DELETE FROM payment_methods'),
    ])
  })

  it('streams a CSV of line items within the date range', async () => {
    const paymentMethodId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)')
      .bind(paymentMethodId, '現金', new Date().toISOString()).run()

    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_name: 'テスト店', purchased_at: '2026-09-01', payment_method_id: paymentMethodId,
        receipt_total: 100, image_key: 'receipts/x.jpg',
        items: [{ name: 'りんご', price: 100, quantity: 1, category: '食費' }],
      }),
    }, env)

    const res = await exportRoutes.request('/export.csv?from=2026-09-01&to=2026-09-30', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    const text = await res.text()
    expect(text).toContain('テスト店')
    expect(text).toContain('現金')
    expect(text).toContain('りんご')
  })
})
