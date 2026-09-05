import type { Category } from './categories'

export interface PaymentMethod {
  id: string
  name: string
  created_at: string
}

export interface ReceiptItemInput {
  name: string
  price: number
  quantity: number
  category: Category
}

export interface ReceiptItem extends ReceiptItemInput {
  id: string
  receipt_id: string
  sort_order: number
  amount: number
}

export interface Receipt {
  id: string
  store_name: string
  purchased_at: string
  payment_method_id: string
  receipt_total: number | null
  image_key: string
  created_at: string
}

export interface ReceiptWithItems extends Receipt {
  items: ReceiptItem[]
}

export interface OcrDraft {
  store_name: string
  purchased_at: string
  receipt_total: number | null
  items: ReceiptItemInput[]
  image_key: string
}
