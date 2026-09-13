# 即DL

ユーザー登録して、ダイレクトダウンロードリンクを作成・編集・ファイル差し替えできます。

## Cloudflare（Git 連携）

ダッシュボードの **Build configuration** にこれを入れてください。

- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`

Deploy command が空だとデプロイされません。今のログでは `npx wrangler deploy` になっていればそのままで大丈夫です。

GitHub には次を必ず含めてください。

- `wrangler.jsonc`
- `worker.js`（ルート直下）
- `public/` フォルダ一式

`wrangler.jsonc` だけ上げると、今回のように Worker が見つからず落ちます。

Cloudflare ダッシュボードで R2 が有効になっていることを確認してください。

本番では Variables の `SESSION_SECRET` を長いランダムな文字列に変えてください。

## ローカル起動（Node）

```bash
npm install
npm start
```

http://localhost:3000
