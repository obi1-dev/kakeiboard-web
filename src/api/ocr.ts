import { Hono } from 'hono'
import { CATEGORIES, isCategory } from '../shared/categories'
import type { OcrDraft, ReceiptItemInput } from '../shared/types'

type Bindings = {
  RECEIPTS_BUCKET: R2Bucket
  AI: Ai
  OCR_MODEL_ID: string
}

export const ocrRoutes = new Hono<{ Bindings: Bindings }>()

export function buildOcrPrompt(): string {
  return `あなたはレシートの画像から購入情報を抽出するアシスタントです。
画像を読み取り、以下のJSONスキーマに厳密に従って結果を出力してください。説明文やマークダウンのコードフェンスは付けず、JSONのみを出力してください。

{
  "store_name": "string",
  "purchased_at": "YYYY-MM-DD",
  "receipt_total": number | null,
  "items": [
    { "name": "string", "price": number, "quantity": number, "category": "${CATEGORIES.join('" | "')}" }
  ]
}

- price は各明細の単価(円、税込表示のまま)
- quantity が読み取れない場合は1とする
- category は必ず上記${CATEGORIES.length}種類のいずれかを選ぶ。判断が難しい場合は「その他」とする
- receipt_total はレシートに印字された合計金額。読み取れない場合はnull`
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

export function parseOcrResponse(response: GeminiResponse): OcrDraft {
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('OCR response contained no text')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('OCR response was not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('OCR response was not a JSON object')
  }

  const raw = parsed as Record<string, unknown>
  const rawItems = Array.isArray(raw.items) ? raw.items : []

  const items: ReceiptItemInput[] = rawItems.map((rawItem) => {
    const item = (rawItem ?? {}) as Record<string, unknown>
    const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
    const price = typeof item.price === 'number' ? item.price : 0
    return {
      name: typeof item.name === 'string' ? item.name : '不明な商品',
      price,
      quantity,
      category: isCategory(item.category) ? item.category : 'その他',
    }
  })

  return {
    store_name: typeof raw.store_name === 'string' ? raw.store_name : '',
    purchased_at: typeof raw.purchased_at === 'string'
      ? raw.purchased_at
      : new Date().toISOString().slice(0, 10),
    receipt_total: typeof raw.receipt_total === 'number' ? raw.receipt_total : null,
    items,
    image_key: '', // 呼び出し元(uploadReceiptImage後)が設定する
  }
}

export async function runOcr(
  ai: { run: Ai['run'] },
  modelId: string,
  base64Image: string,
): Promise<OcrDraft> {
  const response = (await ai.run(modelId, {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildOcrPrompt() },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any, { gateway: { id: 'default' } })) as GeminiResponse
  return parseOcrResponse(response)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function uploadReceiptImage(
  bucket: R2Bucket,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const key = `receipts/${crypto.randomUUID()}.jpg`
  await bucket.put(key, bytes, { httpMetadata: { contentType } })
  return key
}

ocrRoutes.post('/', async (c) => {
  const formData = await c.req.formData()
  const image = formData.get('image')
  if (!(image instanceof File)) {
    return c.json({ error: 'image file is required' }, 400)
  }

  const bytes = await image.arrayBuffer()
  const imageKey = await uploadReceiptImage(c.env.RECEIPTS_BUCKET, bytes, image.type || 'image/jpeg')

  let draft: OcrDraft
  try {
    const base64Image = arrayBufferToBase64(bytes)
    draft = await runOcr(c.env.AI, c.env.OCR_MODEL_ID, base64Image)
  } catch (err) {
    return c.json({ error: `OCR failed: ${(err as Error).message}`, image_key: imageKey }, 502)
  }

  draft.image_key = imageKey
  return c.json(draft)
})
