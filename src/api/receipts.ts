import { Hono } from 'hono'
import type { ReceiptItemInput } from '../shared/types'

type Bindings = { DB: D1Database; RECEIPTS_BUCKET: R2Bucket }

export const receiptsRoutes = new Hono<{ Bindings: Bindings }>()

interface ReceiptPayload {
  store_name: string
  purchased_at: string
  payment_method_id: string
  receipt_total: number | null
  image_key: string
  items: ReceiptItemInput[]
}

async function replaceReceiptItems(db: D1Database, receiptId: string, items: ReceiptItemInput[]) {
  await db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(receiptId).run()
  if (items.length === 0) return
  const statements = items.map((item, index) =>
    db.prepare(
      'INSERT INTO receipt_items (id, receipt_id, sort_order, name, price, quantity, amount, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), receiptId, index, item.name, item.price, item.quantity,
      item.price * item.quantity, item.category,
    )
  )
  await db.batch(statements)
}

receiptsRoutes.post('/receipts', async (c) => {
  const body = await c.req.json<ReceiptPayload>()
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()

  await c.env.DB.prepare(
    'INSERT INTO receipts (id, store_name, purchased_at, payment_method_id, receipt_total, image_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.store_name, body.purchased_at, body.payment_method_id, body.receipt_total, body.image_key, created_at).run()

  await replaceReceiptItems(c.env.DB, id, body.items)

  return c.json({ id, created_at }, 201)
})

receiptsRoutes.get('/receipts', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const storeName = c.req.query('store_name')
  const paymentMethodId = c.req.query('payment_method_id')

  const conditions: string[] = []
  const params: string[] = []
  if (from) { conditions.push('purchased_at >= ?'); params.push(from) }
  if (to) { conditions.push('purchased_at <= ?'); params.push(to) }
  if (storeName) { conditions.push('store_name LIKE ?'); params.push(`%${storeName}%`) }
  if (paymentMethodId) { conditions.push('payment_method_id = ?'); params.push(paymentMethodId) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { results: receipts } = await c.env.DB.prepare(
    `SELECT * FROM receipts ${where} ORDER BY purchased_at DESC, created_at DESC`
  ).bind(...params).all<Record<string, unknown>>()

  if (receipts.length === 0) {
    return c.json([])
  }

  const ids = receipts.map((r) => r.id as string)
  const placeholders = ids.map(() => '?').join(',')
  const { results: items } = await c.env.DB.prepare(
    `SELECT * FROM receipt_items WHERE receipt_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...ids).all<Record<string, unknown>>()

  const itemsByReceipt = new Map<string, Record<string, unknown>[]>()
  for (const item of items) {
    const key = item.receipt_id as string
    const list = itemsByReceipt.get(key) ?? []
    list.push(item)
    itemsByReceipt.set(key, list)
  }

  return c.json(receipts.map((r) => ({ ...r, items: itemsByReceipt.get(r.id as string) ?? [] })))
})

receiptsRoutes.get('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const receipt = await c.env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first()
  if (!receipt) return c.json({ error: 'not found' }, 404)
  const { results: items } = await c.env.DB.prepare(
    'SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order ASC'
  ).bind(id).all()
  return c.json({ ...receipt, items })
})

receiptsRoutes.put('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<ReceiptPayload>()

  const result = await c.env.DB.prepare(
    'UPDATE receipts SET store_name = ?, purchased_at = ?, payment_method_id = ?, receipt_total = ? WHERE id = ?'
  ).bind(body.store_name, body.purchased_at, body.payment_method_id, body.receipt_total, id).run()
  if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404)

  await replaceReceiptItems(c.env.DB, id, body.items)

  return c.json({ id })
})

receiptsRoutes.delete('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const receipt = await c.env.DB.prepare('SELECT image_key FROM receipts WHERE id = ?')
    .bind(id).first<{ image_key: string }>()
  if (!receipt) return c.json({ error: 'not found' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(id),
  ])
  await c.env.RECEIPTS_BUCKET.delete(receipt.image_key)

  return c.body(null, 204)
})

receiptsRoutes.get('/store-names', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT store_name FROM receipts ORDER BY store_name ASC'
  ).all<{ store_name: string }>()
  return c.json(results.map((r) => r.store_name))
})
