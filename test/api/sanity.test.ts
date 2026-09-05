import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('backend bindings sanity check', () => {
  it('can insert and read from D1', async () => {
    await env.DB.prepare(
      'INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)'
    ).bind('sanity-id', '現金', new Date().toISOString()).run()

    const row = await env.DB.prepare(
      'SELECT name FROM payment_methods WHERE id = ?'
    ).bind('sanity-id').first<{ name: string }>()

    expect(row?.name).toBe('現金')
  })

  it('can write and read from R2', async () => {
    await env.RECEIPTS_BUCKET.put('sanity/test.txt', 'hello')
    const obj = await env.RECEIPTS_BUCKET.get('sanity/test.txt')
    expect(await obj?.text()).toBe('hello')
  })
})
