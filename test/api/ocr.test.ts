import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { parseOcrResponse, runOcr, uploadReceiptImage } from '../../src/api/ocr'

function geminiTextResponse(payload: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }
}

describe('parseOcrResponse', () => {
  it('parses a well-formed Gemini response', () => {
    const draft = parseOcrResponse(geminiTextResponse({
      store_name: 'テストスーパー',
      purchased_at: '2026-09-01',
      receipt_total: 300,
      items: [{ name: 'りんご', price: 100, quantity: 2, category: '食費' }],
    }))
    expect(draft.store_name).toBe('テストスーパー')
    expect(draft.purchased_at).toBe('2026-09-01')
    expect(draft.receipt_total).toBe(300)
    expect(draft.items).toEqual([{ name: 'りんご', price: 100, quantity: 2, category: '食費' }])
  })

  it('falls back an unknown category to その他', () => {
    const draft = parseOcrResponse(geminiTextResponse({
      store_name: 'x', purchased_at: '2026-09-01', receipt_total: null,
      items: [{ name: '謎の商品', price: 100, quantity: 1, category: '謎カテゴリ' }],
    }))
    expect(draft.items[0].category).toBe('その他')
  })

  it('defaults missing quantity to 1', () => {
    const draft = parseOcrResponse(geminiTextResponse({
      store_name: 'x', purchased_at: '2026-09-01', receipt_total: null,
      items: [{ name: '商品', price: 100, category: '食費' }],
    }))
    expect(draft.items[0].quantity).toBe(1)
  })

  it('throws when the response has no text', () => {
    expect(() => parseOcrResponse({ candidates: [] })).toThrow()
  })

  it('throws when the text is not valid JSON', () => {
    const response = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }
    expect(() => parseOcrResponse(response)).toThrow()
  })
})

describe('runOcr', () => {
  it('calls ai.run with the given model id and returns the parsed draft', async () => {
    const mockRun = vi.fn().mockResolvedValue(geminiTextResponse({
      store_name: 'モックストア', purchased_at: '2026-09-01', receipt_total: 100, items: [],
    }))

    const draft = await runOcr({ run: mockRun }, 'google/gemini-3.1-pro', 'ZmFrZS1iYXNlNjQ=')

    expect(mockRun).toHaveBeenCalledWith(
      'google/gemini-3.1-pro',
      expect.objectContaining({
        contents: expect.any(Array),
        generationConfig: { responseMimeType: 'application/json' },
      }),
      { gateway: { id: 'default' } },
    )
    expect(draft.store_name).toBe('モックストア')
  })
})

describe('uploadReceiptImage', () => {
  it('stores the image in R2 under receipts/ and returns the key', async () => {
    const bytes = new TextEncoder().encode('fake-image-bytes').buffer
    const key = await uploadReceiptImage(env.RECEIPTS_BUCKET, bytes, 'image/jpeg')
    expect(key).toMatch(/^receipts\/.+\.jpg$/)
    const stored = await env.RECEIPTS_BUCKET.get(key)
    expect(await stored?.text()).toBe('fake-image-bytes')
  })
})
