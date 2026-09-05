import type {
  OcrDraft, PaymentMethod, ReceiptItemInput, ReceiptWithItems,
} from '../../shared/types'

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function getPaymentMethods() {
  return request<PaymentMethod[]>('/api/payment-methods', undefined)
}

export function createPaymentMethod(name: string) {
  return request<PaymentMethod>('/api/payment-methods', jsonInit('POST', { name }))
}

export function updatePaymentMethod(id: string, name: string) {
  return request<PaymentMethod>(`/api/payment-methods/${id}`, jsonInit('PUT', { name }))
}

export function deletePaymentMethod(id: string) {
  return request<void>(`/api/payment-methods/${id}`, { method: 'DELETE' })
}

export async function runOcr(file: File): Promise<OcrDraft> {
  const formData = new FormData()
  formData.set('image', file)
  const res = await fetch('/api/ocr', { method: 'POST', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `OCR failed: ${res.status}`)
  }
  return res.json()
}

export interface ReceiptPayload {
  store_name: string
  purchased_at: string
  payment_method_id: string
  receipt_total: number | null
  image_key: string
  items: ReceiptItemInput[]
}

export function saveReceipt(payload: ReceiptPayload) {
  return request<{ id: string }>('/api/receipts', jsonInit('POST', payload))
}

export function updateReceipt(id: string, payload: ReceiptPayload) {
  return request<{ id: string }>(`/api/receipts/${id}`, jsonInit('PUT', payload))
}

export function deleteReceipt(id: string) {
  return request<void>(`/api/receipts/${id}`, { method: 'DELETE' })
}

export interface ReceiptFilters {
  from?: string
  to?: string
  store_name?: string
  payment_method_id?: string
}

export function getReceipts(filters: ReceiptFilters = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return request<ReceiptWithItems[]>(`/api/receipts${query ? `?${query}` : ''}`, undefined)
}

export function getReceipt(id: string) {
  return request<ReceiptWithItems>(`/api/receipts/${id}`, undefined)
}

export function getStoreNames() {
  return request<string[]>('/api/store-names', undefined)
}

export function exportCsvUrl(from?: string, to?: string): string {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  return `/api/export.csv${query ? `?${query}` : ''}`
}
