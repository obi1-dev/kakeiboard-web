# レシートOCR明細記録アプリ 設計仕様

- 日付: 2026-09-05
- ステータス: 承認済み(実装計画へ)

## 背景・目的

マネーフォワードMEでクレジットカード連携により「いつ・どこで・いくら使ったか」は半自動記録できているが、「そこで何を買ったか」の明細は記録されない。本アプリはその明細データの収集に特化し、マネーフォワードME側のCSV(日付・金額・加盟店名)と本アプリのCSV(日時・店名・金額・明細・カテゴリ)をAIエージェントが突き合わせて分析できるようにする。

**本アプリは家計簿機能(集計・予算・グラフ等)を持たない。** レシート画像のOCR→確認→記録→CSV出力に機能を絞る。

## スコープ外(YAGNI)

- 認証・ユーザー管理(Cloudflare Accessで保護するため不要、プロトタイプは自分専用)
- 家計簿的な集計・グラフ・予算管理
- カテゴリのユーザー管理画面(固定の少数カテゴリのみ)
- ドラフト(未確定)画像のR2クリーンアップ処理(将来課題として明記のみ)
- ダークモード対応

## 技術スタック

- Cloudflare Workers(Hono + Vite、既存scaffoldを利用)
- D1(リレーショナルデータ: payment_methods / receipts / receipt_items)
- R2(レシート原本画像)
- Workers AI binding(`env.AI.run()`)経由でOCR。サードパーティモデル(Gemini/Claude)も同一バインディングで直接呼び出せ、BYOKや個別のAI Gateway設定は不要(Cloudflareアカウントの統合課金に乗る)。
- フロントエンド: React + shadcn/ui + Tailwind CSS + lucide-react(モノトーン基調、絵文字不使用)
- テスト: Vitest(バックエンドは `@cloudflare/vitest-pool-workers`、フロントエンドは `@testing-library/react`)

## OCRモデル選定

Roboflow Vision Evals(2026年9月時点)のOCR特化スコアで比較:

| モデル | OCR精度 | コスト/サンプル |
|---|---|---|
| Claude Opus 5 | 93.2% | $0.020 |
| Gemini 3.1 Pro | 92.6% | $0.0066(約1/3) |

精度差は誤差範囲のため、コスト優位な **Gemini 3.1 Pro (`google/gemini-3.1-pro`) をデフォルト採用**。モデルIDを環境変数(`OCR_MODEL_ID`)で切り替え可能にし、`anthropic/claude-opus-5` へのフォールバック/比較を容易にする。

呼び出しは統一形式:

```ts
const response = await env.AI.run(
  env.OCR_MODEL_ID, // 'google/gemini-3.1-pro' など
  { contents: [{ role: 'user', parts: [
    { text: OCR_PROMPT },
    { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
  ] }] },
  { gateway: { id: 'default' } },
)
```

`OCR_PROMPT` は固定カテゴリ列挙を含め、以下のJSONスキーマで返すよう指示する:

```json
{
  "store_name": "string",
  "purchased_at": "YYYY-MM-DD",
  "receipt_total": 1234,
  "items": [
    { "name": "string", "price": 100, "quantity": 1, "category": "食費|日用品|衣類|外食|医療|娯楽|その他" }
  ]
}
```

## アーキテクチャ

- Hono JSXが唯一のシェルページ(`GET /`、および他のクライアントルートのcatch-all)をSSRし、`<div id="root">` + `<Script src="/src/client/main.tsx">` を返す。
- 実際のUI(支払い方法管理・スキャン・確認・履歴・CSV出力)は、そこにマウントされる1つのReact island(クライアントサイドルーティングを持つSPA相当)が担当する。
- データ操作は全て `/api/*` のJSON APIをHonoが提供し、D1・R2・`env.AI` を呼び出す。

## データモデル(D1)

```sql
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  purchased_at TEXT NOT NULL,       -- レシート記載の購入日(OCR抽出、編集可)
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  receipt_total INTEGER,            -- OCRが読み取ったレシート合計(NULL可: 読み取れなかった場合)
  image_key TEXT NOT NULL,          -- R2キー。スキャン画面は必ず画像から開始するため常に存在する
  created_at TEXT NOT NULL
);

CREATE TABLE receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,           -- 単価
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,          -- price * quantity(CSV/分析用に非正規化して保持)
  category TEXT NOT NULL            -- 固定enumのいずれか
);
```

固定カテゴリ: `食費` `日用品` `衣類` `外食` `医療` `娯楽` `その他`

各テーブルの `id` はWorker側で `crypto.randomUUID()` により生成する。

## 画面/コンポーネント構成

- **PaymentMethodsPage** — 支払い方法のCRUD(Table/Dialog/Input/Button)。名前のみ登録。
- **ScanPage** — 支払い方法選択(Select)、画像取得(`<input type=file accept=image/* capture=environment>` をshadcnボタンでラップ、SPは直接カメラ起動・PCはファイル選択)。送信で `/api/ocr` を呼ぶ。
- **ConfirmPage** — OCR結果を編集可能な明細テーブルで表示。行の追加/削除、品名・単価・数量・カテゴリのインライン編集(価格・数量からamountを自動再計算)。店名はCombobox+オートコンプリート(過去店名候補は `/api/receipts` の既存データから取得)。購入日編集。明細合計(Σamount)とOCR抽出のreceipt_totalが不一致ならAlertで警告(保存はブロックしない)。「OK」で `/api/receipts` にPOSTして確定保存。
- **HistoryPage** — 過去レシート一覧(日付・店名・支払い方法でフィルタ)。行クリックで詳細表示・編集・削除。ツールバーに日付範囲ピッカー+CSVダウンロードボタン。

アイコンは全てlucide-reactを使用し、絵文字は使わない。配色はモノトーン(グレースケール中心、アクセントは最小限)。PC/SP両対応のレスポンシブレイアウト。

## API

| Method/Path | 概要 |
|---|---|
| GET/POST/PUT/DELETE `/api/payment-methods` | 支払い方法CRUD |
| POST `/api/ocr` | multipart画像+payment_method_id受け取り→R2保存→`env.AI.run`でOCR→未保存ドラフトJSON返却 |
| GET `/api/receipts` | 一覧(日付範囲/店名/支払い方法でフィルタ) |
| POST `/api/receipts` | 確定保存(receipts + receipt_itemsをバッチ挿入) |
| GET `/api/receipts/:id` | 詳細取得 |
| PUT `/api/receipts/:id` | 編集 |
| DELETE `/api/receipts/:id` | 削除(cascadeでitemsも削除) |
| GET `/api/export.csv?from=&to=` | 明細単位CSVをストリーム返却 |

CSV列: `purchased_at, store_name, payment_method, item_name, unit_price, quantity, amount, category`

## データフロー

1. スキャン画面で支払い方法選択+画像指定 → `/api/ocr` にPOST
2. WorkerがR2に画像保存 → `env.AI.run` でOCR実行 → JSONパース・正規化して**D1には保存せず**ドラフトとして返す(image_keyも含める)
3. 確認画面でドラフト表示、ユーザー編集、合計不一致チェック(クライアント側)
4. 「OK」で `/api/receipts` にPOST → receipts + receipt_items をD1にバッチ挿入
5. 履歴・CSV出力はD1へのクエリのみ

## エラーハンドリング

- OCR呼び出し失敗(通信エラー/不正JSON): 502を返す。フロントは再試行ボタンを表示(画像は既にR2にあるため再アップロード不要)。何度失敗しても手動入力(空の明細テーブルから開始)にフォールバックでき、記録自体は止まらない。
- 画像サイズ超過: クライアント側でCanvasリサイズ後アップロード。サーバー側でも上限チェック。
- D1書き込み失敗: エラートースト表示、確認画面の入力内容は保持(再送可能)。
- 確認前に離脱した場合のドラフトR2画像の孤立は、プロトタイプ規模では許容し、クリーンアップは実装しない(既知の制約として記録)。

## テスト方針

- バックエンド: `@cloudflare/vitest-pool-workers` でD1/R2バインディングを使ったAPIルートのテスト(CRUD、レシート保存とamount計算、CSV整形、フィルタリング)。`env.AI.run` はモックし、OCRレスポンスのJSON正規化ロジックは純粋関数として切り出してユニットテスト。
- フロントエンド: Vitest + `@testing-library/react` で `ConfirmPage` の行追加/削除・amount再計算・合計不一致警告・カテゴリ選択、`PaymentMethodsPage` のCRUD操作(fetchはモック)。

## 既知の制約(将来課題)

- ドラフト段階で離脱したR2画像のクリーンアップは未実装
- カテゴリは固定enumのみ(ユーザー管理不可)
- OCRモデルの精度に依存するため、手書き文字や感熱紙の退色レシートは読み取り精度が下がる可能性がある
