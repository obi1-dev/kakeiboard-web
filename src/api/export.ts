import { Hono } from 'hono'

type Bindings = { DB: D1Database }

export const exportRoutes = new Hono<{ Bindings: Bindings }>()

interface CsvRow {
  purchased_at: string
  store_name: string
  payment_method: string
  item_name: string
  unit_price: number
  quantity: number
  amount: number
  category: string
}

function escapeCsvField(value: string | number): string {
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowsToCsv(rows: CsvRow[]): string {
  const header = ['purchased_at', 'store_name', 'payment_method', 'item_name', 'unit_price', 'quantity', 'amount', 'category']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.purchased_at, row.store_name, row.payment_method, row.item_name,
      row.unit_price, row.quantity, row.amount, row.category,
    ].map(escapeCsvField).join(','))
  }
  return lines.join('\n')
}

exportRoutes.get('/export.csv', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')

  const conditions: string[] = []
  const params: string[] = []
  if (from) { conditions.push('r.purchased_at >= ?'); params.push(from) }
  if (to) { conditions.push('r.purchased_at <= ?'); params.push(to) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { results } = await c.env.DB.prepare(`
    SELECT r.purchased_at as purchased_at, r.store_name as store_name, pm.name as payment_method,
           ri.name as item_name, ri.price as unit_price, ri.quantity as quantity,
           ri.amount as amount, ri.category as category
    FROM receipt_items ri
    JOIN receipts r ON ri.receipt_id = r.id
    JOIN payment_methods pm ON r.payment_method_id = pm.id
    ${where}
    ORDER BY r.purchased_at ASC, r.created_at ASC, ri.sort_order ASC
  `).bind(...params).all<CsvRow>()

  const csv = rowsToCsv(results)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="receipts.csv"',
    },
  })
})
