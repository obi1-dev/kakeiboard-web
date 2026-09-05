```txt
pnpm install
pnpm exec wrangler d1 migrations apply kakeiboard-web-db --local
pnpm run dev
```

`pnpm run dev`(Cloudflare Vite Plugin)はローカルD1のテーブルを自動作成しないため、初回および`migrations/`配下にファイルを追加した際は上記の`--local`マイグレーション適用を先に実行してください(`pnpm test`はテスト用セットアップ内で自動的にマイグレーションを適用するため不要です)。

D1・R2バインディングはローカルSQLite/ファイルシステムで動作しますが、`AI`バインディングはローカルシミュレータが存在せず常にリモート接続を必要とします(テスト自体は`env.AI`を呼び出しませんが、`wrangler.jsonc`にバインディングが定義されているだけで接続確立が試みられます)。通常は問題になりませんが、**Cloudflareアカウントを複数リンクしている環境**では`pnpm test`実行時に以下のようなエラーになることがあります:

```
More than one account available but unable to select one in non-interactive mode.
```

この場合は`CLOUDFLARE_ACCOUNT_ID`環境変数に使用したいアカウントIDを設定してから実行してください:

```txt
CLOUDFLARE_ACCOUNT_ID=<your-account-id> pnpm test
```

アカウントが1つしかリンクされていない環境では、この環境変数は不要です。

```txt
pnpm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
pnpm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

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
