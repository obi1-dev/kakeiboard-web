import { describe, expect, it } from 'vitest'
import { CATEGORIES, isCategory } from '../../src/shared/categories'

describe('categories', () => {
  it('has exactly the 7 fixed categories', () => {
    expect(CATEGORIES).toEqual(['食費', '日用品', '衣類', '外食', '医療', '娯楽', 'その他'])
  })

  it('isCategory returns true only for known categories', () => {
    expect(isCategory('食費')).toBe(true)
    expect(isCategory('謎カテゴリ')).toBe(false)
    expect(isCategory(123)).toBe(false)
  })
})
