import { describe, expect, it, vi } from 'vitest'
import { resizeImage } from '../../src/client/lib/resizeImage'

describe('resizeImage', () => {
  it('returns the original file untouched when canvas APIs are unavailable in the test env, but resolves without throwing', async () => {
    // jsdom does not implement canvas rendering; resizeImage must fall back
    // to returning the original file rather than throwing when drawImage/toBlob
    // are unsupported. This documents that safety-net behavior.
    const file = new File(['fake-bytes'], 'receipt.jpg', { type: 'image/jpeg' })
    const result = await resizeImage(file, 1600, 0.8)
    expect(result).toBeInstanceOf(File)
    expect(result.name).toBe('receipt.jpg')
  })
})
