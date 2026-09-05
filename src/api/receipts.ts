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

const RECEIPTS_LIST_LIMIT = 500

interface ReceiptItemJoinRow {
  id: string
  store_name: string
  purchased_at: string
  payment_method_id: string
  receipt_total: number | null
  image_key: string
  created_at: string
  item_id: string | null
  item_sort_order: number | null
  item_name: string | null
  item_price: number | null
  item_quantity: number | null
  item_amount: number | null
  item_category: string | null
}

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

  // Single query with a LEFT JOIN (rather than N separate lookups or an
  // `IN (...)` clause bound with one parameter per receipt id) so the number
  // of bound parameters stays fixed regardless of how many receipts match -
  // D1 caps bound parameters per query at ~100, which an `IN` clause over
  // receipt ids would blow past once history grows large. The receipts side
  // is limited/ordered in a subquery so pagination applies to receipts, not
  // to the flattened item rows.
  const { results: rows } = await c.env.DB.prepare(`
    SELECT
      r.id as id, r.store_name as store_name, r.purchased_at as purchased_at,
      r.payment_method_id as payment_method_id, r.receipt_total as receipt_total,
      r.image_key as image_key, r.created_at as created_at,
      ri.id as item_id, ri.sort_order as item_sort_order, ri.name as item_name,
      ri.price as item_price, ri.quantity as item_quantity, ri.amount as item_amount,
      ri.category as item_category
    FROM (
      SELECT * FROM receipts ${where}
      ORDER BY purchased_at DESC, created_at DESC
      LIMIT ${RECEIPTS_LIST_LIMIT}
    ) r
    LEFT JOIN receipt_items ri ON ri.receipt_id = r.id
    ORDER BY r.purchased_at DESC, r.created_at DESC, ri.sort_order ASC
  `).bind(...params).all<ReceiptItemJoinRow>()

  const receiptsById = new Map<string, Record<string, unknown>>()
  const order: string[] = []
  for (const row of rows) {
    let receipt = receiptsById.get(row.id)
    if (!receipt) {
      receipt = {
        id: row.id,
        store_name: row.store_name,
        purchased_at: row.purchased_at,
        payment_method_id: row.payment_method_id,
        receipt_total: row.receipt_total,
        image_key: row.image_key,
        created_at: row.created_at,
        items: [] as Record<string, unknown>[],
      }
      receiptsById.set(row.id, receipt)
      order.push(row.id)
    }
    if (row.item_id !== null) {
      (receipt.items as Record<string, unknown>[]).push({
        id: row.item_id,
        receipt_id: row.id,
        sort_order: row.item_sort_order,
        name: row.item_name,
        price: row.item_price,
        quantity: row.item_quantity,
        amount: row.item_amount,
        category: row.item_category,
      })
    }
  }

  return c.json(order.map((id) => receiptsById.get(id)))
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
