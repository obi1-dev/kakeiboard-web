export const CATEGORIES = ['食費', '日用品', '衣類', '外食', '医療', '娯楽', 'その他'] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}
