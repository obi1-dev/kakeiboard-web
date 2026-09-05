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

  it('mounts receipts API under /api', async () => {
    const res = await exports.default.fetch('https://example.com/api/receipts', undefined, env)
    expect(res.status).not.toBe(404)
  })

  it('mounts export API under /api', async () => {
    const res = await exports.default.fetch('https://example.com/api/export.csv', undefined, env)
    expect(res.status).not.toBe(404)
  })

  it('mounts OCR API under /api/ocr', async () => {
    const res = await exports.default.fetch('https://example.com/api/ocr', { method: 'POST' }, env)
    expect(res.status).not.toBe(404)
  })

  it('returns a JSON 404 for unmatched /api/* paths instead of the HTML shell', async () => {
    const res = await exports.default.fetch('https://example.com/api/does-not-exist', undefined, env)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})
