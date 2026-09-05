# レシートOCR明細記録アプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レシート画像をOCRして商品明細(品名・単価・数量・カテゴリ)と店名・支払い方法を記録し、CSV出力できるCloudflare Workersアプリを構築する。

**Architecture:** Hono(Workers)が `/api/*` のJSON APIをD1・R2・`env.AI`を使って提供し、それ以外の全パスにHono JSXシェル(`<div id="root">` + クライアントスクリプト)を返す。実際のUIは1つのReact island(shadcn/ui + Tailwind v4、react-router-domでクライアントルーティング)がその`#root`にマウントされて担当する。

**Tech Stack:** Hono 4, Vite 8, React 19, react-router-dom, shadcn/ui, Tailwind CSS v4, lucide-react, D1, R2, Workers AI binding(`env.AI.run`)、Vitest(`@cloudflare/vitest-plugin` + `@testing-library/react`)。

**Spec:** `docs/superpowers/specs/2026-09-05-receipt-ocr-tracker-design.md`

## Global Constraints

- 認証機構は実装しない(Cloudflare Accessで保護する前提)。
- ダークモード対応は不要。配色はモノトーン(グレースケール中心)。
- アイコンは全て`lucide-react`を使用し、絵文字は使わない。
- カテゴリは固定7種のenumのみ: `食費` `日用品` `衣類` `外食` `医療` `娯楽` `その他`。
- OCR呼び出しは`env.AI.run(modelId, input, { gateway: { id: 'default' } })`のみを使う。BYOKやAI Gatewayの手動URL構築は行わない。
- サードパーティモデルへの入力は Gemini generateContent REST 形式(`contents[].parts[]`、画像は`inlineData: { mimeType, data }`、JSON強制出力は`generationConfig.responseMimeType: 'application/json'` — いずれもcamelCase)。
- 金額は全て整数(円)。小数は扱わない。
- D1のIDは全て`crypto.randomUUID()`で生成する。
- 各タスック完了時に`pnpm test`(バックエンド)および該当する場合`pnpm run test:client`(フロントエンド)がパスすること。

---

## Task 1: バックエンド基盤(D1/R2/AIバインディング + マイグレーション + Vitest設定)

**Files:**
- Modify: `wrangler.jsonc`
- Create: `migrations/0001_init.sql`
- Create: `vitest.config.ts`
- Create: `test/api/apply-migrations.ts`
- Create: `test/api/sanity.test.ts`

**Interfaces:**
- Produces: D1バインディング`DB`、R2バインディング`RECEIPTS_BUCKET`、AIバインディング`AI`、環境変数`OCR_MODEL_ID`。以降の全バックエンドタスクはこれらを`c.env.DB` / `c.env.RECEIPTS_BUCKET` / `c.env.AI` / `c.env.OCR_MODEL_ID`として利用する。
- Produces: テスト実行コマンド `pnpm test`(このタスク以降、全バックエンドテストはこの設定で動く)。

- [ ] **Step 1: `wrangler.jsonc`にD1/R2/AI/varsバインディングを追加**

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "kakeiboard-web",
	"compatibility_date": "2025-08-03",
	"main": "./src/index.tsx",
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "kakeiboard-web-db",
			// ローカル開発・テストはこのダミーIDのままで動く。
			// 本番デプロイ前に `wrangler d1 create kakeiboard-web-db` を実行し、
			// 返却された database_id に置き換えること(Task 15参照)。
			"database_id": "00000000-0000-0000-0000-000000000000",
			"migrations_dir": "./migrations"
		}
	],
	"r2_buckets": [
		{
			"binding": "RECEIPTS_BUCKET",
			// 本番デプロイ前に `wrangler r2 bucket create kakeiboard-web-receipts` を実行すること
			"bucket_name": "kakeiboard-web-receipts"
		}
	],
	"ai": {
		"binding": "AI"
	},
	"vars": {
		"OCR_MODEL_ID": "google/gemini-3.1-pro"
	}
}
```

- [ ] **Step 2: D1マイグレーションファイルを作成**

`migrations/0001_init.sql`:

```sql
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  receipt_total INTEGER,
  image_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  sort_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL
);

CREATE INDEX idx_receipts_purchased_at ON receipts(purchased_at);
CREATE INDEX idx_receipt_items_receipt_id ON receipt_items(receipt_id);
```

(削除時のitems連鎖削除はアプリ側で明示的に行うため`ON DELETE CASCADE`には依存しない。Task 5参照。)

- [ ] **Step 3: 依存パッケージをインストール**

```bash
pnpm add -D @cloudflare/vitest-plugin vitest
```

- [ ] **Step 4: `vitest.config.ts`を作成**

```typescript
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, 'migrations')
  const migrations = await readD1Migrations(migrationsPath)

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // テスト内でマイグレーションを適用するためのテスト専用バインディング
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['test/api/**/*.test.ts'],
      setupFiles: ['./test/api/apply-migrations.ts'],
    },
  }
})
```

- [ ] **Step 5: マイグレーション適用用セットアップファイルを作成**

`test/api/apply-migrations.ts`:

```typescript
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

- [ ] **Step 6: 疎通確認用のsanityテストを書く**

`test/api/sanity.test.ts`:

```typescript
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
```

- [ ] **Step 7: `package.json`にテストスクリプトを追加**

`scripts`に追加:

```json
"test": "vitest run --config vitest.config.ts"
```

- [ ] **Step 8: テストを実行して通ることを確認**

Run: `pnpm test`
Expected: `test/api/sanity.test.ts`の2件がPASS

- [ ] **Step 9: 型生成とコミット**

```bash
pnpm run cf-typegen
git add wrangler.jsonc migrations vitest.config.ts test/api/apply-migrations.ts test/api/sanity.test.ts worker-configuration.d.ts package.json package-lock.json
git commit -m "test: add D1/R2/AI bindings and vitest-plugin backend test setup"
```

---

## Task 2: 共有の型とカテゴリ定義

**Files:**
- Create: `src/shared/categories.ts`
- Create: `src/shared/types.ts`
- Test: `test/api/shared-categories.test.ts`

**Interfaces:**
- Produces: `CATEGORIES: readonly string[]`, `type Category`, `isCategory(value: unknown): value is Category` — Task 4(OCR)で使用。
- Produces: `PaymentMethod`, `ReceiptItemInput`, `ReceiptItem`, `Receipt`, `ReceiptWithItems`, `OcrDraft` 型 — Task 3〜9の全バックエンド/フロントエンドタスクで使用。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/shared-categories.test.ts`:

```typescript
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- shared-categories`
Expected: FAIL(`src/shared/categories.ts`が存在しない)

- [ ] **Step 3: `src/shared/categories.ts`を実装**

```typescript
export const CATEGORIES = ['食費', '日用品', '衣類', '外食', '医療', '娯楽', 'その他'] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: `src/shared/types.ts`を実装**

```typescript
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
```

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `pnpm test -- shared-categories`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/shared test/api/shared-categories.test.ts
git commit -m "feat: add shared category and domain types"
```

---

## Task 3: 支払い方法API(CRUD)

**Files:**
- Create: `src/api/payment-methods.ts`
- Test: `test/api/payment-methods.test.ts`

**Interfaces:**
- Consumes: `env.DB`(D1、Task 1で用意)
- Produces: `paymentMethodsRoutes: Hono` — `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`。Task 7で`app.route('/api/payment-methods', paymentMethodsRoutes)`としてマウントされる。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/payment-methods.test.ts`:

```typescript
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { paymentMethodsRoutes } from '../../src/api/payment-methods'

describe('payment methods API', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM payment_methods').run()
  })

  it('creates and lists payment methods', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '現金' }),
    }, env)
    expect(createRes.status).toBe(201)
    const created = await createRes.json<{ id: string; name: string }>()
    expect(created.name).toBe('現金')

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    const list = await listRes.json<{ name: string }[]>()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('現金')
  })

  it('rejects an empty name', async () => {
    const res = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('updates a payment method name', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA' }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const updateRes = await paymentMethodsRoutes.request(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA改' }),
    }, env)
    expect(updateRes.status).toBe(200)

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    const list = await listRes.json<{ name: string }[]>()
    expect(list[0].name).toBe('カードA改')
  })

  it('returns 404 when updating an unknown id', async () => {
    const res = await paymentMethodsRoutes.request('/does-not-exist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    }, env)
    expect(res.status).toBe(404)
  })

  it('deletes a payment method', async () => {
    const createRes = await paymentMethodsRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '削除対象' }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const deleteRes = await paymentMethodsRoutes.request(`/${id}`, { method: 'DELETE' }, env)
    expect(deleteRes.status).toBe(204)

    const listRes = await paymentMethodsRoutes.request('/', {}, env)
    expect(await listRes.json()).toEqual([])
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- payment-methods`
Expected: FAIL(`src/api/payment-methods.ts`が存在しない)

- [ ] **Step 3: `src/api/payment-methods.ts`を実装**

```typescript
import { Hono } from 'hono'

type Bindings = { DB: D1Database }

export const paymentMethodsRoutes = new Hono<{ Bindings: Bindings }>()

paymentMethodsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM payment_methods ORDER BY created_at ASC'
  ).all()
  return c.json(results)
})

paymentMethodsRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()
  await c.env.DB.prepare(
    'INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)'
  ).bind(id, name, created_at).run()
  return c.json({ id, name, created_at }, 201)
})

paymentMethodsRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ name: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }
  const result = await c.env.DB.prepare(
    'UPDATE payment_methods SET name = ? WHERE id = ?'
  ).bind(name, id).run()
  if (result.meta.changes === 0) {
    return c.json({ error: 'not found' }, 404)
  }
  return c.json({ id, name })
})

paymentMethodsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    'DELETE FROM payment_methods WHERE id = ?'
  ).bind(id).run()
  if (result.meta.changes === 0) {
    return c.json({ error: 'not found' }, 404)
  }
  return c.body(null, 204)
})
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm test -- payment-methods`
Expected: 5件全てPASS

- [ ] **Step 5: コミット**

```bash
git add src/api/payment-methods.ts test/api/payment-methods.test.ts
git commit -m "feat: add payment methods CRUD API"
```

---

## Task 4: OCRヘルパー関数とAPIルート

**Files:**
- Create: `src/api/ocr.ts`
- Test: `test/api/ocr.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `isCategory`(Task 2), `OcrDraft`, `ReceiptItemInput`(Task 2)
- Produces: `buildOcrPrompt(): string`、`parseOcrResponse(response): OcrDraft`、`runOcr(ai: { run: Ai['run'] }, modelId: string, base64Image: string): Promise<OcrDraft>`、`uploadReceiptImage(bucket: R2Bucket, bytes: ArrayBuffer, contentType: string): Promise<string>`、`ocrRoutes: Hono`(`POST /`)。Task 7で`/api/ocr`にマウントされる。フロントエンドはTask 11でこのエンドポイントを呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/ocr.test.ts`:

```typescript
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- ocr.test`
Expected: FAIL(`src/api/ocr.ts`が存在しない)

- [ ] **Step 3: `src/api/ocr.ts`を実装**

```typescript
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
```

**注記:** `POST /api/ocr`ルート本体(R2アップロード+`env.AI.run`の実呼び出しの合成)は自動テストの対象外とする。`env.AI`は実際にLLMへネットワークリクエストを行う実バインディングであり、`vitest-plugin`のminiflare設定では関数値をバインディングとして注入できないため、モックできない。`runOcr`と`uploadReceiptImage`をそれぞれ独立してテストすることでロジックの正しさを担保し、ルート自体の動作確認はTask 15の手動スモークテストで行う。

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm test -- ocr.test`
Expected: 7件全てPASS

- [ ] **Step 5: コミット**

```bash
git add src/api/ocr.ts test/api/ocr.test.ts
git commit -m "feat: add OCR prompt building, response parsing, and image upload"
```

---

## Task 5: レシートAPI(保存・一覧・詳細・更新・削除)

**Files:**
- Create: `src/api/receipts.ts`
- Test: `test/api/receipts.test.ts`

**Interfaces:**
- Consumes: `ReceiptItemInput`, `Receipt`(Task 2)
- Produces: `receiptsRoutes: Hono` — `POST /receipts`, `GET /receipts`, `GET /receipts/:id`, `PUT /receipts/:id`, `DELETE /receipts/:id`, `GET /store-names`。Task 7で`app.route('/api', receiptsRoutes)`としてマウントされる。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/receipts.test.ts`:

```typescript
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { receiptsRoutes } from '../../src/api/receipts'

async function createPaymentMethod(name: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)'
  ).bind(id, name, new Date().toISOString()).run()
  return id
}

function samplePayload(paymentMethodId: string) {
  return {
    store_name: 'テストスーパー',
    purchased_at: '2026-09-01',
    payment_method_id: paymentMethodId,
    receipt_total: 300,
    image_key: 'receipts/test.jpg',
    items: [
      { name: 'りんご', price: 100, quantity: 2, category: '食費' },
      { name: 'ノート', price: 100, quantity: 1, category: '日用品' },
    ],
  }
}

describe('receipts API', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipt_items'),
      env.DB.prepare('DELETE FROM receipts'),
      env.DB.prepare('DELETE FROM payment_methods'),
    ])
  })

  it('creates a receipt with items and computes amount = price * quantity', async () => {
    const paymentMethodId = await createPaymentMethod('現金')

    const res = await receiptsRoutes.request('/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload(paymentMethodId)),
    }, env)
    expect(res.status).toBe(201)

    const detailRes = await receiptsRoutes.request(`/receipts/${(await res.json<{ id: string }>()).id}`, {}, env)
    const detail = await detailRes.json<{ items: { amount: number }[] }>()
    expect(detail.items).toHaveLength(2)
    expect(detail.items[0].amount).toBe(200)
    expect(detail.items[1].amount).toBe(100)
  })

  it('lists receipts filtered by date range and store name', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), purchased_at: '2026-08-01', store_name: '8月の店' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), purchased_at: '2026-09-01', store_name: '9月の店' }),
    }, env)

    const res = await receiptsRoutes.request('/receipts?from=2026-09-01&to=2026-09-30', {}, env)
    const list = await res.json<{ store_name: string }[]>()
    expect(list).toHaveLength(1)
    expect(list[0].store_name).toBe('9月の店')
  })

  it('updates a receipt and replaces its items', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    const createRes = await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload(paymentMethodId)),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const updateRes = await receiptsRoutes.request(`/receipts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...samplePayload(paymentMethodId),
        store_name: '更新後の店',
        items: [{ name: 'バナナ', price: 50, quantity: 3, category: '食費' }],
      }),
    }, env)
    expect(updateRes.status).toBe(200)

    const detailRes = await receiptsRoutes.request(`/receipts/${id}`, {}, env)
    const detail = await detailRes.json<{ store_name: string; items: { name: string; amount: number }[] }>()
    expect(detail.store_name).toBe('更新後の店')
    expect(detail.items).toHaveLength(1)
    expect(detail.items[0]).toMatchObject({ name: 'バナナ', amount: 150 })
  })

  it('deletes a receipt, its items, and its R2 image', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    const imageKey = `receipts/${crypto.randomUUID()}.jpg`
    await env.RECEIPTS_BUCKET.put(imageKey, 'fake-bytes')

    const createRes = await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), image_key: imageKey }),
    }, env)
    const { id } = await createRes.json<{ id: string }>()

    const deleteRes = await receiptsRoutes.request(`/receipts/${id}`, { method: 'DELETE' }, env)
    expect(deleteRes.status).toBe(204)

    const detailRes = await receiptsRoutes.request(`/receipts/${id}`, {}, env)
    expect(detailRes.status).toBe(404)
    expect(await env.RECEIPTS_BUCKET.get(imageKey)).toBeNull()
  })

  it('lists distinct store names for autocomplete', async () => {
    const paymentMethodId = await createPaymentMethod('現金')
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店A' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店A' }),
    }, env)
    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...samplePayload(paymentMethodId), store_name: '店B' }),
    }, env)

    const res = await receiptsRoutes.request('/store-names', {}, env)
    expect((await res.json()).sort()).toEqual(['店A', '店B'])
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- receipts.test`
Expected: FAIL(`src/api/receipts.ts`が存在しない)

- [ ] **Step 3: `src/api/receipts.ts`を実装**

```typescript
import { Hono } from 'hono'
import type { ReceiptItemInput } from '../shared/types'

type Bindings = { DB: D1Database; RECEIPTS_BUCKET: R2Bucket }

export const receiptsRoutes = new Hono<{ Bindings: Bindings }>()

interface ReceiptPayload {
  store_name: string
  purchased_at: string
  payment_method_id: string
  receipt_total: number | null
  image_key: string
  items: ReceiptItemInput[]
}

async function replaceReceiptItems(db: D1Database, receiptId: string, items: ReceiptItemInput[]) {
  await db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(receiptId).run()
  if (items.length === 0) return
  const statements = items.map((item, index) =>
    db.prepare(
      'INSERT INTO receipt_items (id, receipt_id, sort_order, name, price, quantity, amount, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), receiptId, index, item.name, item.price, item.quantity,
      item.price * item.quantity, item.category,
    )
  )
  await db.batch(statements)
}

receiptsRoutes.post('/receipts', async (c) => {
  const body = await c.req.json<ReceiptPayload>()
  const id = crypto.randomUUID()
  const created_at = new Date().toISOString()

  await c.env.DB.prepare(
    'INSERT INTO receipts (id, store_name, purchased_at, payment_method_id, receipt_total, image_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.store_name, body.purchased_at, body.payment_method_id, body.receipt_total, body.image_key, created_at).run()

  await replaceReceiptItems(c.env.DB, id, body.items)

  return c.json({ id, created_at }, 201)
})

receiptsRoutes.get('/receipts', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const storeName = c.req.query('store_name')
  const paymentMethodId = c.req.query('payment_method_id')

  const conditions: string[] = []
  const params: string[] = []
  if (from) { conditions.push('purchased_at >= ?'); params.push(from) }
  if (to) { conditions.push('purchased_at <= ?'); params.push(to) }
  if (storeName) { conditions.push('store_name LIKE ?'); params.push(`%${storeName}%`) }
  if (paymentMethodId) { conditions.push('payment_method_id = ?'); params.push(paymentMethodId) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { results: receipts } = await c.env.DB.prepare(
    `SELECT * FROM receipts ${where} ORDER BY purchased_at DESC, created_at DESC`
  ).bind(...params).all<Record<string, unknown>>()

  if (receipts.length === 0) {
    return c.json([])
  }

  const ids = receipts.map((r) => r.id as string)
  const placeholders = ids.map(() => '?').join(',')
  const { results: items } = await c.env.DB.prepare(
    `SELECT * FROM receipt_items WHERE receipt_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...ids).all<Record<string, unknown>>()

  const itemsByReceipt = new Map<string, Record<string, unknown>[]>()
  for (const item of items) {
    const key = item.receipt_id as string
    const list = itemsByReceipt.get(key) ?? []
    list.push(item)
    itemsByReceipt.set(key, list)
  }

  return c.json(receipts.map((r) => ({ ...r, items: itemsByReceipt.get(r.id as string) ?? [] })))
})

receiptsRoutes.get('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const receipt = await c.env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first()
  if (!receipt) return c.json({ error: 'not found' }, 404)
  const { results: items } = await c.env.DB.prepare(
    'SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order ASC'
  ).bind(id).all()
  return c.json({ ...receipt, items })
})

receiptsRoutes.put('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<ReceiptPayload>()

  const result = await c.env.DB.prepare(
    'UPDATE receipts SET store_name = ?, purchased_at = ?, payment_method_id = ?, receipt_total = ? WHERE id = ?'
  ).bind(body.store_name, body.purchased_at, body.payment_method_id, body.receipt_total, id).run()
  if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404)

  await replaceReceiptItems(c.env.DB, id, body.items)

  return c.json({ id })
})

receiptsRoutes.delete('/receipts/:id', async (c) => {
  const id = c.req.param('id')
  const receipt = await c.env.DB.prepare('SELECT image_key FROM receipts WHERE id = ?')
    .bind(id).first<{ image_key: string }>()
  if (!receipt) return c.json({ error: 'not found' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM receipts WHERE id = ?').bind(id),
  ])
  await c.env.RECEIPTS_BUCKET.delete(receipt.image_key)

  return c.body(null, 204)
})

receiptsRoutes.get('/store-names', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT DISTINCT store_name FROM receipts ORDER BY store_name ASC'
  ).all<{ store_name: string }>()
  return c.json(results.map((r) => r.store_name))
})
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm test -- receipts.test`
Expected: 5件全てPASS

- [ ] **Step 5: コミット**

```bash
git add src/api/receipts.ts test/api/receipts.test.ts
git commit -m "feat: add receipts CRUD API with item replacement and R2 cleanup"
```

---

## Task 6: CSV出力API

**Files:**
- Create: `src/api/export.ts`
- Test: `test/api/export.test.ts`

**Interfaces:**
- Consumes: `env.DB`(Task 1)
- Produces: `exportRoutes: Hono`(`GET /export.csv`)、`rowsToCsv(rows): string`。Task 7で`app.route('/api', exportRoutes)`としてマウントされる。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/export.test.ts`:

```typescript
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportRoutes, rowsToCsv } from '../../src/api/export'
import { receiptsRoutes } from '../../src/api/receipts'

describe('rowsToCsv', () => {
  it('formats rows with header and escapes commas/quotes', () => {
    const csv = rowsToCsv([
      { purchased_at: '2026-09-01', store_name: 'スーパー, A', payment_method: '現金', item_name: 'りんご"3個"', unit_price: 100, quantity: 2, amount: 200, category: '食費' },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('purchased_at,store_name,payment_method,item_name,unit_price,quantity,amount,category')
    expect(lines[1]).toBe('2026-09-01,"スーパー, A",現金,"りんご""3個""",100,2,200,食費')
  })
})

describe('GET /export.csv', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM receipt_items'),
      env.DB.prepare('DELETE FROM receipts'),
      env.DB.prepare('DELETE FROM payment_methods'),
    ])
  })

  it('streams a CSV of line items within the date range', async () => {
    const paymentMethodId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO payment_methods (id, name, created_at) VALUES (?, ?, ?)')
      .bind(paymentMethodId, '現金', new Date().toISOString()).run()

    await receiptsRoutes.request('/receipts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_name: 'テスト店', purchased_at: '2026-09-01', payment_method_id: paymentMethodId,
        receipt_total: 100, image_key: 'receipts/x.jpg',
        items: [{ name: 'りんご', price: 100, quantity: 1, category: '食費' }],
      }),
    }, env)

    const res = await exportRoutes.request('/export.csv?from=2026-09-01&to=2026-09-30', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    const text = await res.text()
    expect(text).toContain('テスト店')
    expect(text).toContain('現金')
    expect(text).toContain('りんご')
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- export.test`
Expected: FAIL(`src/api/export.ts`が存在しない)

- [ ] **Step 3: `src/api/export.ts`を実装**

```typescript
import { Hono } from 'hono'

type Bindings = { DB: D1Database }

export const exportRoutes = new Hono<{ Bindings: Bindings }>()

interface CsvRow {
  purchased_at: string
  store_name: string
  payment_method: string
  item_name: string
  unit_price: number
  quantity: number
  amount: number
  category: string
}

function escapeCsvField(value: string | number): string {
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowsToCsv(rows: CsvRow[]): string {
  const header = ['purchased_at', 'store_name', 'payment_method', 'item_name', 'unit_price', 'quantity', 'amount', 'category']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.purchased_at, row.store_name, row.payment_method, row.item_name,
      row.unit_price, row.quantity, row.amount, row.category,
    ].map(escapeCsvField).join(','))
  }
  return lines.join('\n')
}

exportRoutes.get('/export.csv', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')

  const conditions: string[] = []
  const params: string[] = []
  if (from) { conditions.push('r.purchased_at >= ?'); params.push(from) }
  if (to) { conditions.push('r.purchased_at <= ?'); params.push(to) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { results } = await c.env.DB.prepare(`
    SELECT r.purchased_at as purchased_at, r.store_name as store_name, pm.name as payment_method,
           ri.name as item_name, ri.price as unit_price, ri.quantity as quantity,
           ri.amount as amount, ri.category as category
    FROM receipt_items ri
    JOIN receipts r ON ri.receipt_id = r.id
    JOIN payment_methods pm ON r.payment_method_id = pm.id
    ${where}
    ORDER BY r.purchased_at ASC, r.created_at ASC, ri.sort_order ASC
  `).bind(...params).all<CsvRow>()

  const csv = rowsToCsv(results)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="receipts.csv"',
    },
  })
})
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm test -- export.test`
Expected: 2件全てPASS

- [ ] **Step 5: コミット**

```bash
git add src/api/export.ts test/api/export.test.ts
git commit -m "feat: add line-item CSV export endpoint"
```

---

## Task 7: Honoシェル(React island用の殱)とルートマウント

**Files:**
- Modify: `src/renderer.tsx`
- Modify: `src/index.tsx`
- Test: `test/api/shell.test.ts`

**Interfaces:**
- Consumes: `paymentMethodsRoutes`(Task 3), `receiptsRoutes`(Task 5), `exportRoutes`(Task 6), `ocrRoutes`(Task 4)
- Produces: 全APIが`/api/*`にマウントされ、それ以外の全パスが`<div id="root">` + `<Script src="/src/client/main.tsx">`を含むHTMLシェルを返す。Task 8以降のフロントエンドはこの`#root`にマウントされる。

- [ ] **Step 1: 失敗するテストを書く**

`test/api/shell.test.ts`:

```typescript
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm test -- shell.test`
Expected: FAIL(`/history`が404、またはmain.tsxへの参照がない)

- [ ] **Step 3: `src/renderer.tsx`を更新**

```tsx
import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>レシート記録</title>
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Script src="/src/client/main.tsx" />
      </body>
    </html>
  )
})
```

- [ ] **Step 4: `src/index.tsx`を更新**

```tsx
import { Hono } from 'hono'
import { renderer } from './renderer'
import { paymentMethodsRoutes } from './api/payment-methods'
import { receiptsRoutes } from './api/receipts'
import { exportRoutes } from './api/export'
import { ocrRoutes } from './api/ocr'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.route('/api/payment-methods', paymentMethodsRoutes)
app.route('/api', receiptsRoutes)
app.route('/api', exportRoutes)
app.route('/api/ocr', ocrRoutes)

app.use(renderer)
app.get('*', (c) => c.render(<div id="root"></div>))

export default app
```

(Task 8で`src/client/main.tsx`を作成するまでは404になるが、シェルHTML自体は正しく返る。テストはHTML文字列の内容のみを検証するため、この時点で通る。)

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `pnpm test -- shell.test`
Expected: 2件全てPASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer.tsx src/index.tsx test/api/shell.test.ts
git commit -m "feat: mount API routes and serve React island shell for all other paths"
```

---

## Task 8: フロントエンド基盤(Tailwind v4 + shadcn/ui + React + ルーター + テスト設定)

**Files:**
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`
- Modify: `src/style.css`
- Create: `components.json`(shadcn CLIが生成)
- Create: `src/lib/utils.ts`(shadcn CLIが生成)
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `vitest.client.config.ts`
- Create: `test/client/setup.ts`
- Test: `test/client/App.test.tsx`

**Interfaces:**
- Produces: `App`コンポーネント(react-router-domのルート定義を持つ)。Task 10〜13で各ページをルートに追加していく。
- Produces: `pnpm run test:client`コマンド。
- Produces: `@/*`パスエイリアス(`src/*`) — 以降のフロントエンドタスクは`@/components/ui/*`, `@/lib/*`の形式でimportする。

- [ ] **Step 1: 依存パッケージをインストール**

```bash
pnpm add react react-dom react-router-dom
pnpm add -D @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom @types/node
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: `vite.config.ts`にReact/Tailwindプラグインとパスエイリアスを追加**

```typescript
import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

export default defineConfig({
  plugins: [cloudflare(), ssrPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3: `tsconfig.json`にパスエイリアスを追加**

`compilerOptions`に追加:

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

- [ ] **Step 4: `src/style.css`をTailwind v4形式に変更**

```css
@import "tailwindcss";
```

- [ ] **Step 5: `src/lib/utils.ts`を作成(shadcnコンポーネントが依存する`cn`ヘルパー)**

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

```bash
pnpm add clsx tailwind-merge class-variance-authority lucide-react
```

- [ ] **Step 6: shadcn/uiを初期化**

```bash
npx shadcn@latest init
```

プロンプトが出た場合: スタイルは`New York`、ベースカラーは`Neutral`(モノトーン基調のため)を選択する。生成される`components.json`と`src/components/ui/`はそのままコミットする。

- [ ] **Step 7: 失敗するテストを書く**

`test/client/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/client/App'

describe('App', () => {
  it('renders the app navigation', () => {
    render(
      <MemoryRouter initialEntries={['/scan']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'スキャン' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '履歴' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '支払い方法' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: `vitest.client.config.ts`を作成**

```typescript
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    include: ['test/client/**/*.test.tsx'],
    setupFiles: ['./test/client/setup.ts'],
  },
})
```

`test/client/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 9: `package.json`にテストスクリプトを追加**

```json
"test:client": "vitest run --config vitest.client.config.ts"
```

- [ ] **Step 10: テストを実行して失敗することを確認**

Run: `pnpm run test:client`
Expected: FAIL(`src/client/App.tsx`が存在しない)

- [ ] **Step 11: `src/client/App.tsx`を実装(この時点ではプレースホルダーページ)**

```tsx
import { Link, Route, Routes } from 'react-router-dom'

function Placeholder({ title }: { title: string }) {
  return <p>{title}</p>
}

export function App() {
  return (
    <div>
      <nav>
        <Link to="/scan">スキャン</Link>
        <Link to="/history">履歴</Link>
        <Link to="/payment-methods">支払い方法</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/scan" element={<Placeholder title="スキャン" />} />
          <Route path="/history" element={<Placeholder title="履歴" />} />
          <Route path="/payment-methods" element={<Placeholder title="支払い方法" />} />
          <Route path="/confirm" element={<Placeholder title="確認" />} />
          <Route path="*" element={<Placeholder title="スキャン" />} />
        </Routes>
      </main>
    </div>
  )
}
```

- [ ] **Step 12: `src/client/main.tsx`を実装**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 13: テストを実行して通ることを確認**

Run: `pnpm run test:client`
Expected: PASS

- [ ] **Step 14: バックエンドテストも壊れていないことを確認**

Run: `pnpm test`
Expected: 既存の全テストPASS(フロントエンド変更はバックエンドに影響しないはずだが念のため確認)

- [ ] **Step 15: コミット**

```bash
git add vite.config.ts tsconfig.json src/style.css src/lib/utils.ts components.json src/components/ui \
  src/client vitest.client.config.ts test/client package.json package-lock.json
git commit -m "feat: scaffold React island with Tailwind v4, shadcn/ui, and client-side routing"
```

---

## Task 9: フロントエンドAPIクライアント

**Files:**
- Create: `src/client/lib/api.ts`
- Test: `test/client/api.test.ts`

**Interfaces:**
- Consumes: `PaymentMethod`, `ReceiptWithItems`, `OcrDraft`, `ReceiptItemInput`(Task 2、`src/shared/`から)
- Produces: `getPaymentMethods`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`, `runOcr(file: File): Promise<OcrDraft>`, `saveReceipt`, `getReceipts(filters)`, `getReceipt(id)`, `updateReceipt(id, payload)`, `deleteReceipt(id)`, `getStoreNames()`, `exportCsvUrl(from?, to?): string` — Task 10〜13の全ページから使用される。

- [ ] **Step 1: 失敗するテストを書く**

`test/client/api.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPaymentMethod, deleteReceipt, exportCsvUrl, getPaymentMethods, getReceipts, saveReceipt,
} from '../../src/client/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('getPaymentMethods calls GET /api/payment-methods and returns json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: '1', name: '現金' }] })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPaymentMethods()

    expect(fetchMock).toHaveBeenCalledWith('/api/payment-methods', undefined)
    expect(result).toEqual([{ id: '1', name: '現金' }])
  })

  it('createPaymentMethod POSTs the name as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '1', name: 'カードA' }) })
    vi.stubGlobal('fetch', fetchMock)

    await createPaymentMethod('カードA')

    expect(fetchMock).toHaveBeenCalledWith('/api/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'カードA' }),
    })
  })

  it('saveReceipt POSTs to /api/receipts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      store_name: '店', purchased_at: '2026-09-01', payment_method_id: 'pm1',
      receipt_total: 100, image_key: 'k', items: [],
    }

    await saveReceipt(payload)

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('getReceipts builds a query string from filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    await getReceipts({ from: '2026-09-01', to: '2026-09-30' })

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts?from=2026-09-01&to=2026-09-30', undefined)
  })

  it('deleteReceipt calls DELETE on the receipt id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await deleteReceipt('r1')

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts/r1', { method: 'DELETE' })
  })

  it('exportCsvUrl builds the download URL with date range', () => {
    expect(exportCsvUrl('2026-09-01', '2026-09-30')).toBe('/api/export.csv?from=2026-09-01&to=2026-09-30')
    expect(exportCsvUrl()).toBe('/api/export.csv')
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- api.test`
Expected: FAIL(`src/client/lib/api.ts`が存在しない)

- [ ] **Step 3: `src/client/lib/api.ts`を実装**

```typescript
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
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `pnpm run test:client -- api.test`
Expected: 6件全てPASS

- [ ] **Step 5: コミット**

```bash
git add src/client/lib/api.ts test/client/api.test.ts
git commit -m "feat: add frontend API client for all backend endpoints"
```

---

## Task 10: 支払い方法管理ページ

**Files:**
- Create: `src/client/pages/PaymentMethodsPage.tsx`
- Modify: `src/client/App.tsx`
- Test: `test/client/PaymentMethodsPage.test.tsx`

**Interfaces:**
- Consumes: `getPaymentMethods`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`(Task 9)
- Produces: `PaymentMethodsPage`コンポーネント。Task 11(ScanPage)がここで登録された支払い方法一覧を選択肢として利用する。

- [ ] **Step 1: shadcnコンポーネントを追加**

```bash
npx shadcn@latest add button table dialog input label
```

- [ ] **Step 2: 失敗するテストを書く**

`test/client/PaymentMethodsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentMethodsPage } from '../../src/client/pages/PaymentMethodsPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

describe('PaymentMethodsPage', () => {
  it('lists existing payment methods', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: '1', name: '現金', created_at: '2026-01-01' },
      { id: '2', name: 'カードA', created_at: '2026-01-02' },
    ])

    render(<PaymentMethodsPage />)

    expect(await screen.findByText('現金')).toBeInTheDocument()
    expect(screen.getByText('カードA')).toBeInTheDocument()
  })

  it('adds a new payment method', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([])
    vi.mocked(api.createPaymentMethod).mockResolvedValue({ id: '3', name: 'カードB', created_at: '2026-01-03' })
    const user = userEvent.setup()

    render(<PaymentMethodsPage />)

    await user.click(await screen.findByRole('button', { name: '追加' }))
    await user.type(screen.getByLabelText('名前'), 'カードB')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.createPaymentMethod).toHaveBeenCalledWith('カードB'))
  })

  it('deletes a payment method', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: '1', name: '現金', created_at: '2026-01-01' },
    ])
    vi.mocked(api.deletePaymentMethod).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<PaymentMethodsPage />)

    await user.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(api.deletePaymentMethod).toHaveBeenCalledWith('1'))
  })
})
```

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- PaymentMethodsPage`
Expected: FAIL(`src/client/pages/PaymentMethodsPage.tsx`が存在しない)

- [ ] **Step 4: `src/client/pages/PaymentMethodsPage.tsx`を実装**

```tsx
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createPaymentMethod, deletePaymentMethod, getPaymentMethods } from '@/client/lib/api'
import type { PaymentMethod } from '@/shared/types'

export function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  async function reload() {
    setMethods(await getPaymentMethods())
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleSave() {
    if (!name.trim()) return
    await createPaymentMethod(name.trim())
    setName('')
    setOpen(false)
    await reload()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('この支払い方法を削除しますか?')) return
    await deletePaymentMethod(id)
    await reload()
  }

  return (
    <div>
      <h1>支払い方法</h1>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>追加</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>支払い方法を追加</DialogTitle>
          </DialogHeader>
          <Label htmlFor="payment-method-name">名前</Label>
          <Input id="payment-method-name" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名前</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {methods.map((method) => (
            <TableRow key={method.id}>
              <TableCell>{method.name}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" aria-label="削除" onClick={() => handleDelete(method.id)}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

**注記:** テストは削除ボタンを`aria-label="削除"`で問い合わせているが、shadcnの`Button`は`aria-label`をそのまま`<button>`要素に渡すため、`getByRole('button', { name: '削除' })`で見つかる。`Trash2`アイコン自体はテキストを持たないため、これがなければボタンに accessible name が付かない点に注意。

- [ ] **Step 5: `src/client/App.tsx`のプレースホルダーを置き換え**

`<Route path="/payment-methods" element={<Placeholder title="支払い方法" />} />`を次に置き換える:

```tsx
<Route path="/payment-methods" element={<PaymentMethodsPage />} />
```

(importを追加: `import { PaymentMethodsPage } from './pages/PaymentMethodsPage'`)

- [ ] **Step 6: テストを実行して通ることを確認**

Run: `pnpm run test:client`
Expected: 全テストPASS(既存のApp.test.tsxも壊れていないこと)

- [ ] **Step 7: コミット**

```bash
git add src/client/pages/PaymentMethodsPage.tsx src/client/App.tsx test/client/PaymentMethodsPage.test.tsx src/components/ui
git commit -m "feat: add payment methods management page"
```

---

## Task 11: スキャン画面(画像取得・リサイズ・OCR呼び出し)

**Files:**
- Create: `src/client/pages/ScanPage.tsx`
- Create: `src/client/lib/resizeImage.ts`
- Modify: `src/client/App.tsx`
- Test: `test/client/resizeImage.test.ts`
- Test: `test/client/ScanPage.test.tsx`

**Interfaces:**
- Consumes: `getPaymentMethods`(Task 9), `runOcr`(Task 9)
- Produces: `resizeImage(file: File, maxDimension: number, quality: number): Promise<File>` — 大きな画像をアップロード前に縮小してOCRコストとアップロード時間を削減する。`ScanPage`は取得したOCRドラフトを`navigate('/confirm', { state: { draft, paymentMethodId } })`でConfirmPage(Task 12)へ渡す。

- [ ] **Step 1: shadcnコンポーネントを追加**

```bash
npx shadcn@latest add select
```

- [ ] **Step 2: 失敗するテストを書く(resizeImage)**

`test/client/resizeImage.test.ts`:

```typescript
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
```

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- resizeImage`
Expected: FAIL(`src/client/lib/resizeImage.ts`が存在しない)

- [ ] **Step 4: `src/client/lib/resizeImage.ts`を実装**

```typescript
export async function resizeImage(file: File, maxDimension: number, quality: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) {
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) {
      return file
    }
    return new File([blob], file.name, { type: 'image/jpeg' })
  } catch {
    // createImageBitmap / canvas がテスト環境(jsdom)や一部ブラウザで
    // 使えない場合は、リサイズせず元ファイルをそのまま使う
    return file
  }
}
```

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `pnpm run test:client -- resizeImage`
Expected: PASS

- [ ] **Step 6: 失敗するテストを書く(ScanPage)**

`test/client/ScanPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ScanPage } from '../../src/client/pages/ScanPage'
import * as api from '../../src/client/lib/api'
import * as resizeModule from '../../src/client/lib/resizeImage'

vi.mock('../../src/client/lib/api')
vi.mock('../../src/client/lib/resizeImage')

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

describe('ScanPage', () => {
  it('runs OCR on the selected image and navigates to /confirm with the draft', async () => {
    vi.mocked(api.getPaymentMethods).mockResolvedValue([
      { id: 'pm1', name: '現金', created_at: '2026-01-01' },
    ])
    const file = new File(['bytes'], 'receipt.jpg', { type: 'image/jpeg' })
    vi.mocked(resizeModule.resizeImage).mockResolvedValue(file)
    const draft = {
      store_name: 'テスト店', purchased_at: '2026-09-01', receipt_total: 100,
      items: [], image_key: 'receipts/x.jpg',
    }
    vi.mocked(api.runOcr).mockResolvedValue(draft)
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ScanPage />
      </MemoryRouter>
    )

    const fileInput = await screen.findByLabelText('レシート画像')
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'スキャン開始' }))

    await waitFor(() => expect(api.runOcr).toHaveBeenCalled())
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/confirm', {
      state: { draft, paymentMethodId: 'pm1' },
    }))
  })
})
```

- [ ] **Step 7: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- ScanPage`
Expected: FAIL(`src/client/pages/ScanPage.tsx`が存在しない)

- [ ] **Step 8: `src/client/pages/ScanPage.tsx`を実装**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getPaymentMethods, runOcr } from '@/client/lib/api'
import { resizeImage } from '@/client/lib/resizeImage'
import type { PaymentMethod } from '@/shared/types'

export function ScanPage() {
  const navigate = useNavigate()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [paymentMethodId, setPaymentMethodId] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPaymentMethods().then((list) => {
      setMethods(list)
      if (list.length > 0) setPaymentMethodId(list[0].id)
    })
  }, [])

  async function handleScan() {
    if (!file || !paymentMethodId) return
    setLoading(true)
    setError(null)
    try {
      const resized = await resizeImage(file, 1600, 0.8)
      const draft = await runOcr(resized)
      navigate('/confirm', { state: { draft, paymentMethodId } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>レシートをスキャン</h1>

      <Label htmlFor="payment-method-select">支払い方法</Label>
      <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
        <SelectTrigger id="payment-method-select">
          <SelectValue placeholder="支払い方法を選択" />
        </SelectTrigger>
        <SelectContent>
          {methods.map((method) => (
            <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label htmlFor="receipt-image">レシート画像</Label>
      <input
        id="receipt-image"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <Button onClick={handleScan} disabled={!file || !paymentMethodId || loading}>
        <Camera /> {loading ? 'スキャン中...' : 'スキャン開始'}
      </Button>

      {error && (
        <p role="alert">
          {error}(もう一度試すか、確認画面で手動入力してください)
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 9: `src/client/App.tsx`にルートを追加**

`<Route path="/scan" element={<Placeholder title="スキャン" />} />`と`<Route path="*" ...>`を置き換える:

```tsx
<Route path="/scan" element={<ScanPage />} />
{/* ... */}
<Route path="*" element={<ScanPage />} />
```

(importを追加: `import { ScanPage } from './pages/ScanPage'`)

- [ ] **Step 10: テストを実行して通ることを確認**

Run: `pnpm run test:client`
Expected: 全テストPASS

- [ ] **Step 11: コミット**

```bash
git add src/client/pages/ScanPage.tsx src/client/lib/resizeImage.ts src/client/App.tsx \
  test/client/resizeImage.test.ts test/client/ScanPage.test.tsx src/components/ui
git commit -m "feat: add scan page with client-side image resize and OCR trigger"
```

---

## Task 12: 確認画面(明細編集・オートコンプリート・合計不一致警告・保存)

**Files:**
- Create: `src/client/pages/ConfirmPage.tsx`
- Modify: `src/client/App.tsx`
- Test: `test/client/ConfirmPage.test.tsx`

**Interfaces:**
- Consumes: `getStoreNames`, `saveReceipt`, `updateReceipt`, `getReceipt`(Task 9)、`CATEGORIES`(Task 2)、`useLocation().state`として`{ draft: OcrDraft, paymentMethodId: string }`(Task 11のScanPageが渡す、新規保存モード)、または`useParams<{ id: string }>()`の`id`(Task 13のHistoryPageが`/receipts/:id/edit`へリンクする、編集モード)
- Produces: `ConfirmPage`コンポーネント。新規保存モードでは`saveReceipt`、編集モードでは`updateReceipt`を呼ぶ。保存成功後は`navigate('/history')`する。

- [ ] **Step 1: shadcnコンポーネントを追加**

```bash
npx shadcn@latest add alert
```

- [ ] **Step 2: 失敗するテストを書く**

`test/client/ConfirmPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmPage } from '../../src/client/pages/ConfirmPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

const draft = {
  store_name: 'テストスーパー',
  purchased_at: '2026-09-01',
  receipt_total: 300,
  image_key: 'receipts/x.jpg',
  items: [
    { name: 'りんご', price: 100, quantity: 2, category: '食費' },
  ],
}

function renderConfirmPage() {
  vi.mocked(api.getStoreNames).mockResolvedValue(['テストスーパー', '別の店'])
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/confirm', state: { draft, paymentMethodId: 'pm1' } }]}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
        <Route path="/history" element={<p>履歴ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderConfirmPageInEditMode() {
  vi.mocked(api.getStoreNames).mockResolvedValue(['テストスーパー'])
  vi.mocked(api.getReceipt).mockResolvedValue({
    id: 'r1', store_name: 'テストスーパー', purchased_at: '2026-09-01',
    payment_method_id: 'pm1', receipt_total: 300, image_key: 'receipts/x.jpg', created_at: '2026-09-01',
    items: [{ id: 'i1', receipt_id: 'r1', sort_order: 0, name: 'りんご', price: 100, quantity: 2, amount: 200, category: '食費' }],
  })
  return render(
    <MemoryRouter initialEntries={['/receipts/r1/edit']}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
        <Route path="/history" element={<p>履歴ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConfirmPage', () => {
  it('shows a mismatch warning when items total differs from the OCR receipt total', async () => {
    renderConfirmPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/一致しません/)
  })

  it('adds a new item row', async () => {
    const user = userEvent.setup()
    renderConfirmPage()

    await user.click(await screen.findByRole('button', { name: '行を追加' }))

    const nameInputs = screen.getAllByLabelText('品名')
    expect(nameInputs).toHaveLength(2)
  })

  it('removes an item row', async () => {
    const user = userEvent.setup()
    renderConfirmPage()

    await screen.findByLabelText('品名')
    await user.click(screen.getAllByRole('button', { name: '削除' })[0])

    expect(screen.queryAllByLabelText('品名')).toHaveLength(0)
  })

  it('saves the receipt and navigates to /history', async () => {
    vi.mocked(api.saveReceipt).mockResolvedValue({ id: 'r1' })
    const user = userEvent.setup()
    renderConfirmPage()

    await screen.findByLabelText('品名')
    await user.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({
      store_name: 'テストスーパー',
      payment_method_id: 'pm1',
      image_key: 'receipts/x.jpg',
      items: [{ name: 'りんご', price: 100, quantity: 2, category: '食費' }],
    })))
    expect(await screen.findByText('履歴ページ')).toBeInTheDocument()
  })

  it('loads an existing receipt in edit mode and calls updateReceipt on save', async () => {
    vi.mocked(api.updateReceipt).mockResolvedValue({ id: 'r1' })
    const user = userEvent.setup()
    renderConfirmPageInEditMode()

    expect(await screen.findByDisplayValue('テストスーパー')).toBeInTheDocument()
    expect(await screen.findByLabelText('品名')).toHaveValue('りんご')

    await user.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.updateReceipt).toHaveBeenCalledWith('r1', expect.objectContaining({
      store_name: 'テストスーパー',
      payment_method_id: 'pm1',
      items: [{ name: 'りんご', price: 100, quantity: 2, category: '食費' }],
    })))
    expect(await screen.findByText('履歴ページ')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- ConfirmPage`
Expected: FAIL(`src/client/pages/ConfirmPage.tsx`が存在しない)

- [ ] **Step 4: `src/client/pages/ConfirmPage.tsx`を実装(新規保存モードと編集モードの両対応)**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getReceipt, getStoreNames, saveReceipt, updateReceipt } from '@/client/lib/api'
import { CATEGORIES } from '@/shared/categories'
import type { OcrDraft, ReceiptItemInput } from '@/shared/types'

interface ConfirmPageState {
  draft: OcrDraft
  paymentMethodId: string
}

export function ConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: receiptId } = useParams<{ id: string }>()
  const state = location.state as ConfirmPageState | null

  const [loaded, setLoaded] = useState(!receiptId)
  const [storeName, setStoreName] = useState(state?.draft.store_name ?? '')
  const [purchasedAt, setPurchasedAt] = useState(state?.draft.purchased_at ?? '')
  const [paymentMethodId, setPaymentMethodId] = useState(state?.paymentMethodId ?? '')
  const [receiptTotal, setReceiptTotal] = useState<number | null>(state?.draft.receipt_total ?? null)
  const [imageKey, setImageKey] = useState(state?.draft.image_key ?? '')
  const [items, setItems] = useState<ReceiptItemInput[]>(state?.draft.items ?? [])
  const [storeNames, setStoreNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getStoreNames().then(setStoreNames)
  }, [])

  useEffect(() => {
    if (!receiptId) return
    getReceipt(receiptId).then((receipt) => {
      setStoreName(receipt.store_name)
      setPurchasedAt(receipt.purchased_at)
      setPaymentMethodId(receipt.payment_method_id)
      setReceiptTotal(receipt.receipt_total)
      setImageKey(receipt.image_key)
      setItems(receipt.items.map(({ name, price, quantity, category }) => ({ name, price, quantity, category })))
      setLoaded(true)
    })
  }, [receiptId])

  const itemsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  )
  const mismatch = receiptTotal !== null && receiptTotal !== itemsTotal

  if (!receiptId && !state) {
    return <p>スキャンからやり直してください</p>
  }
  if (!loaded) {
    return <p>読み込み中...</p>
  }

  function updateItem(index: number, patch: Partial<ReceiptItemInput>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, { name: '', price: 0, quantity: 1, category: 'その他' }])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        store_name: storeName,
        purchased_at: purchasedAt,
        payment_method_id: paymentMethodId,
        receipt_total: receiptTotal,
        image_key: imageKey,
        items,
      }
      if (receiptId) {
        await updateReceipt(receiptId, payload)
      } else {
        await saveReceipt(payload)
      }
      navigate('/history')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1>確認</h1>

      <Label htmlFor="store-name">店名</Label>
      <Input
        id="store-name"
        list="store-name-options"
        value={storeName}
        onChange={(e) => setStoreName(e.target.value)}
      />
      <datalist id="store-name-options">
        {storeNames.map((name) => <option key={name} value={name} />)}
      </datalist>

      <Label htmlFor="purchased-at">購入日</Label>
      <Input
        id="purchased-at"
        type="date"
        value={purchasedAt}
        onChange={(e) => setPurchasedAt(e.target.value)}
      />

      {mismatch && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>合計が一致しません</AlertTitle>
          <AlertDescription>
            レシートの合計({receiptTotal}円)と明細の合計({itemsTotal}円)が一致しません。
            見落としや読み取りミスがないか確認してください。
          </AlertDescription>
        </Alert>
      )}

      {items.map((item, index) => (
        <div key={index}>
          <Label htmlFor={`item-name-${index}`}>品名</Label>
          <Input
            id={`item-name-${index}`}
            aria-label="品名"
            value={item.name}
            onChange={(e) => updateItem(index, { name: e.target.value })}
          />
          <Label htmlFor={`item-price-${index}`}>単価</Label>
          <Input
            id={`item-price-${index}`}
            type="number"
            value={item.price}
            onChange={(e) => updateItem(index, { price: Number(e.target.value) })}
          />
          <Label htmlFor={`item-quantity-${index}`}>数量</Label>
          <Input
            id={`item-quantity-${index}`}
            type="number"
            value={item.quantity}
            onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
          />
          <Select value={item.category} onValueChange={(value) => updateItem(index, { category: value as ReceiptItemInput['category'] })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" aria-label="削除" onClick={() => removeItem(index)}>
            <Trash2 />
          </Button>
        </div>
      ))}

      <Button variant="outline" onClick={addItem}>
        <Plus /> 行を追加
      </Button>

      <p>明細合計: {itemsTotal}円</p>

      <Button onClick={handleSave} disabled={saving}>OK</Button>
    </div>
  )
}
```

- [ ] **Step 5: `src/client/App.tsx`にルートを追加(新規保存モードと編集モードの両方)**

```tsx
<Route path="/confirm" element={<ConfirmPage />} />
<Route path="/receipts/:id/edit" element={<ConfirmPage />} />
```

(importを追加: `import { ConfirmPage } from './pages/ConfirmPage'`)

- [ ] **Step 6: テストを実行して通ることを確認**

Run: `pnpm run test:client`
Expected: 全テストPASS

- [ ] **Step 7: コミット**

```bash
git add src/client/pages/ConfirmPage.tsx src/client/App.tsx test/client/ConfirmPage.test.tsx src/components/ui
git commit -m "feat: add confirm page with editable items, mismatch warning, and save"
```

---

## Task 13: 履歴一覧・フィルタ・CSVダウンロード

**Files:**
- Create: `src/client/pages/HistoryPage.tsx`
- Modify: `src/client/App.tsx`
- Test: `test/client/HistoryPage.test.tsx`

**Interfaces:**
- Consumes: `getReceipts`, `deleteReceipt`, `exportCsvUrl`(Task 9)
- Produces: `HistoryPage`コンポーネント。各行に`/receipts/:id/edit`(Task 12のConfirmPage編集モード)へのリンクを持つ。

- [ ] **Step 1: 失敗するテストを書く**

`test/client/HistoryPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { HistoryPage } from '../../src/client/pages/HistoryPage'
import * as api from '../../src/client/lib/api'

vi.mock('../../src/client/lib/api')

function renderHistoryPage() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/receipts/:id/edit" element={<p>編集ページ</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const sampleReceipts = [
  {
    id: 'r1', store_name: 'テストスーパー', purchased_at: '2026-09-01',
    payment_method_id: 'pm1', receipt_total: 200, image_key: 'k', created_at: '2026-09-01',
    items: [{ id: 'i1', receipt_id: 'r1', sort_order: 0, name: 'りんご', price: 100, quantity: 2, amount: 200, category: '食費' }],
  },
]

describe('HistoryPage', () => {
  it('lists past receipts with their store name and total', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)

    renderHistoryPage()

    expect(await screen.findByText('テストスーパー')).toBeInTheDocument()
    expect(screen.getByText('2026-09-01')).toBeInTheDocument()
  })

  it('re-fetches with date filters when the filter form is submitted', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue([])
    const user = userEvent.setup()

    renderHistoryPage()
    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({}))

    await user.type(screen.getByLabelText('開始日'), '2026-09-01')
    await user.type(screen.getByLabelText('終了日'), '2026-09-30')
    await user.click(screen.getByRole('button', { name: '絞り込む' }))

    await waitFor(() => expect(api.getReceipts).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }))
  })

  it('deletes a receipt', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)
    vi.mocked(api.deleteReceipt).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    renderHistoryPage()

    await user.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => expect(api.deleteReceipt).toHaveBeenCalledWith('r1'))
  })

  it('links each row to its edit page', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue(sampleReceipts)

    renderHistoryPage()

    const editLink = await screen.findByRole('link', { name: '編集' })
    expect(editLink).toHaveAttribute('href', '/receipts/r1/edit')
  })

  it('renders a CSV download link using the current date filters', async () => {
    vi.mocked(api.getReceipts).mockResolvedValue([])
    vi.mocked(api.exportCsvUrl).mockReturnValue('/api/export.csv?from=2026-09-01')

    renderHistoryPage()

    const link = await screen.findByRole('link', { name: 'CSVダウンロード' })
    expect(link).toHaveAttribute('href', '/api/export.csv?from=2026-09-01')
  })
})
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `pnpm run test:client -- HistoryPage`
Expected: FAIL(`src/client/pages/HistoryPage.tsx`が存在しない)

- [ ] **Step 3: `src/client/pages/HistoryPage.tsx`を実装**

```tsx
import { useEffect, useState } from 'react'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deleteReceipt, exportCsvUrl, getReceipts } from '@/client/lib/api'
import type { ReceiptWithItems } from '@/shared/types'

export function HistoryPage() {
  const [receipts, setReceipts] = useState<ReceiptWithItems[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function reload(filters: { from?: string; to?: string } = {}) {
    setReceipts(await getReceipts(filters))
  }

  useEffect(() => {
    reload()
  }, [])

  function handleFilter() {
    reload({ from: from || undefined, to: to || undefined })
  }

  async function handleDelete(id: string) {
    if (!window.confirm('この記録を削除しますか?')) return
    await deleteReceipt(id)
    await reload({ from: from || undefined, to: to || undefined })
  }

  function itemsTotal(receipt: ReceiptWithItems): number {
    return receipt.items.reduce((sum, item) => sum + item.amount, 0)
  }

  return (
    <div>
      <h1>履歴</h1>

      <Label htmlFor="from-date">開始日</Label>
      <Input id="from-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Label htmlFor="to-date">終了日</Label>
      <Input id="to-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <Button onClick={handleFilter}>絞り込む</Button>

      <Button asChild variant="outline">
        <a href={exportCsvUrl(from || undefined, to || undefined)}>
          <Download /> CSVダウンロード
        </a>
      </Button>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>購入日</TableHead>
            <TableHead>店名</TableHead>
            <TableHead>合計</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((receipt) => (
            <TableRow key={receipt.id}>
              <TableCell>{receipt.purchased_at}</TableCell>
              <TableCell>{receipt.store_name}</TableCell>
              <TableCell>{itemsTotal(receipt)}円</TableCell>
              <TableCell>
                <Button asChild variant="ghost" size="icon" aria-label="編集">
                  <Link to={`/receipts/${receipt.id}/edit`}>
                    <Pencil />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" aria-label="削除" onClick={() => handleDelete(receipt.id)}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 4: `src/client/App.tsx`にルートを追加**

`<Route path="/history" element={<Placeholder title="履歴" />} />`を置き換える:

```tsx
<Route path="/history" element={<HistoryPage />} />
```

(importを追加: `import { HistoryPage } from './pages/HistoryPage'`。この時点で`Placeholder`は未使用になるため削除する。)

- [ ] **Step 5: テストを実行して通ることを確認**

Run: `pnpm run test:client`
Expected: 全テストPASS

- [ ] **Step 6: コミット**

```bash
git add src/client/pages/HistoryPage.tsx src/client/App.tsx test/client/HistoryPage.test.tsx src/components/ui
git commit -m "feat: add history page with filtering, deletion, and CSV export link"
```

---

## Task 14: モノトーンなスタイル調整とナビゲーションの仕上げ

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: Task 8〜13で作成した全ページ
- Produces: PC/SP両対応のナビゲーション付きレイアウト。以降のタスクなし(最終仕上げ)。

- [ ] **Step 1: `src/client/App.tsx`にモノトーンなナビゲーションレイアウトを実装**

```tsx
import { NavLink, Route, Routes } from 'react-router-dom'
import { Camera, History, Wallet } from 'lucide-react'
import { ConfirmPage } from './pages/ConfirmPage'
import { HistoryPage } from './pages/HistoryPage'
import { PaymentMethodsPage } from './pages/PaymentMethodsPage'
import { ScanPage } from './pages/ScanPage'

const navItems = [
  { to: '/scan', label: 'スキャン', icon: Camera },
  { to: '/history', label: '履歴', icon: History },
  { to: '/payment-methods', label: '支払い方法', icon: Wallet },
]

export function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 pb-16 md:pb-0 md:flex">
      <nav className="border-b md:border-b-0 md:border-r md:w-56 md:shrink-0 fixed bottom-0 left-0 right-0 md:static bg-white z-10">
        <ul className="flex md:flex-col justify-around md:justify-start md:gap-1 md:p-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex-1 md:flex-none">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex flex-col md:flex-row items-center gap-1 md:gap-2 p-3 rounded-md text-sm ${
                    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`
                }
              >
                <Icon size={20} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-4 md:p-8 max-w-2xl">
        <Routes>
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/confirm" element={<ConfirmPage />} />
          <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="*" element={<ScanPage />} />
        </Routes>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: テストを実行して通ることを確認(App.test.tsxのリンク名は変更していないため通るはず)**

Run: `pnpm run test:client`
Expected: 全テストPASS

- [ ] **Step 3: コミット**

```bash
git add src/client/App.tsx src/style.css
git commit -m "style: add monotone responsive navigation layout"
```

---

## Task 15: 手動スモークテストとREADME整備

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 全タスクの成果物
- Produces: なし(最終タスク)。デプロイ前提条件の明文化。

- [ ] **Step 1: ローカルで一通り動作確認する**

```bash
pnpm run cf-typegen
pnpm test
pnpm run test:client
pnpm run dev
```

ブラウザで `http://localhost:5173`(または表示されたポート)を開き、以下を手動確認する:

1. `/payment-methods` で支払い方法を追加できる
2. `/scan` で追加した支払い方法が選択でき、画像ファイルを選んで「スキャン開始」を押すと `/confirm` に遷移する(実際に`env.AI.run`を呼ぶため、初回はローカルのCloudflareアカウントに紐づく実際のOCR呼び出しが発生する点に注意)
3. `/confirm` で明細を編集し「OK」を押すと `/history` に遷移し、保存したレシートが一覧に表示される
4. `/history` で日付範囲を絞り込み、「CSVダウンロード」でCSVがダウンロードされ、内容が明細単位になっている
5. `/history` で削除ボタンを押すと一覧から消える

Expected: 上記5点が全て問題なく動作する。問題があれば該当タスクに戻って修正する。

- [ ] **Step 2: `README.md`にセットアップ手順を追記**

`README.md`に追記:

```markdown
## 初回セットアップ(本番デプロイ前)

このプロジェクトはD1・R2・Workers AIバインディングを使用します。ローカル開発(`pnpm run dev`)とテスト(`pnpm test`)は`wrangler.jsonc`のダミーのD1 `database_id`のままローカルSQLiteで動作しますが、**本番デプロイ前には以下が必要です**:

```txt
npx wrangler d1 create kakeiboard-web-db
# 出力された database_id を wrangler.jsonc の d1_databases[0].database_id に反映

npx wrangler r2 bucket create kakeiboard-web-receipts

npx wrangler d1 migrations apply kakeiboard-web-db --remote
```

OCRモデルは`wrangler.jsonc`の`vars.OCR_MODEL_ID`で切り替え可能です(デフォルト: `google/gemini-3.1-pro`。`anthropic/claude-opus-5`等に変更可)。APIキーの管理は不要です(Cloudflareアカウントの統合課金経由)。

このアプリはCloudflare Access配下での利用を前提としており、アプリ自体に認証機能はありません。
```

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: add D1/R2 setup instructions for production deploy"
```
