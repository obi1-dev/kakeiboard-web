import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('app shell', () => {
  it('mounts payment-methods API under /api/payment-methods', async () => {
    const res = await exports.default.fetch('https://example.com/api/payment-methods', undefined, env)
    expect(res.status).toBe(200)
  })

  it('serves the React island shell for any other path', async () => {
    const res = await exports.default.fetch('https://example.com/history', undefined, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<div id="root">')
    expect(html).toContain('/src/client/main.tsx')
  })
})
