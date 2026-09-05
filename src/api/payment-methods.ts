import { Hono } from 'hono'

type Bindings = { DB: D1Database }

export const paymentMethodsRoutes = new Hono<{ Bindings: Bindings }>()

paymentMethodsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM payment_methods ORDER BY created_at ASC'
  ).all()
  return c.json(results)
})

paymentMethodsRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await c.env.DB.prepare(
    'INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)'
  ).bind(id, name, created_at).run()
  return c.json({ id, name, created_at }, 201)
})

paymentMethodsRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ name: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }
  const result = await c.env.DB.prepare(
    'UPDATE payment_methods SET name = ? WHERE id = ?'
  ).bind(name, id).run()
  if (result.meta.changes === 0) {
    return c.json({ error: 'not found' }, 404)
  }
  return c.json({ id, name })
})

paymentMethodsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM payment_methods WHERE id = ?'
    ).bind(id).run()
    if (result.meta.changes === 0) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.body(null, 204)
  } catch (err) {
    if ((err as Error).message?.includes('FOREIGN KEY constraint failed')) {
      return c.json({ error: 'この支払い方法はレシートで使用されているため削除できません' }, 409)
    }
    throw err
  }
})
