# AIの切り替え（端末内AI ⇔ Claude API）

## しくみ
- 画面は `createAI` で作った `ClosetAI`（`src/ai/types.ts`）だけを呼ぶ
- `createAI(settings)`（`src/ai/index.ts`）が設定を見て `LocalAI` か `ClaudeAI` を返す
- どちらも同じ型（`GarmentAnalysis` / `Outfit[]` / `PurchaseSuggestion[]`）を返すので、画面側の変更はいらない
- Claudeモードでは `withFallback` で包み、失敗したら端末内AIで同じ処理をやり直す

```
画面 ──▶ ClosetAI ──┬─▶ LocalAI ─── Transformers.js / 点数付け（端末内）
                     └─▶ ClaudeAI ── fetch /api/ai/* ──▶ server/ ──▶ Claude API
```

## 端末内AI（LocalAI）の種類・柄の判定のしくみ
- CLIP（`Xenova/clip-vit-base-patch32`）の**写真側のモデルだけ**を端末で動かす（`CLIPVisionModelWithProjection`。WebGPU が使える端末は fp16・約175MB、それ以外は CPU の wasm で q8・約88MB。初回だけダウンロードし、ブラウザのキャッシュに残る）
- 説明文側（"a product photo of a t-shirt" など 81文＋柄12文）の数値は開発時に計算して `src/ai/local/textEmbeddings.json` に同梱する（`npm run ai:embeddings`）。端末では写真1枚につきモデルを1回動かし、その数値と全部の説明文の近さ（CLIPと同じ温度100の softmax）を取って、種類ごとに合計する
  - 以前は写真ごとに説明文70文余りを文章側のモデルに読ませ直し、写真側も種類と柄で2回動かしていた。計算量はおよそ1/10になり、ダウンロードも半分以下になる
  - 同梱の数値といまの言い方がずれていたら（単体テストで止まる）、端末で文章側のモデルを使って計算し直すので動かなくはならない
- 文のひな型は3つ（`TYPE_TEMPLATES`）を平均する。実写真（clothing-dataset-small、713枚）で種類の正解率が約92%→約94.5%に上がった
- 「服でないもの」（帽子・バッグなど）の言い方も入れてあり、それが1位なら種類は分からないと答えて選んでもらう（帽子を「ニット」と言い切らない。データセットの帽子26枚は全部そうなった）
- 「服を追加」画面を開いた時点でモデルの読み込みを始める（`ClosetAI.prepare`）。体の写真の読み取り（MediaPipe）も画面を開いた時点で準備を始める
- GitHub Actions の「AI check」（`.github/workflows/ai-check.yml`）が、実際のモデルで同梱の数値の一致と、データセットでの正解率を確かめる

## Claude APIに切り替える手順
1. 中継サーバーを用意する（`server/`）。`ANTHROPIC_API_KEY` を環境変数で渡す
   - 公開する場合は、サーバーを置く場所（例：Cloud Run、Render、Vercel Functions など）を決める。未決定
   - 別のドメインに置く場合は `ALLOWED_ORIGIN` にアプリのURLを入れ、アプリ側の `VITE_AI_API_BASE` にサーバーのURLを入れる
2. アプリの `.env` で `VITE_AI_PROVIDER=claude` にする（または設定画面で切り替える）
3. 使うモデルは `CLAUDE_MODEL`（初期値 `claude-opus-5-5`）。写真の判定だけ別のモデルにしたいときは `CLAUDE_MODEL_ANALYZE`

## 中継サーバーのエンドポイント
| パス | 中身 | 送るもの |
| --- | --- | --- |
| `POST /api/ai/analyze` | 写真から種類・色 | 写真（長辺768pxのJPEGに縮めてから。1024pxのときより送る量・読む量が約4割減） |
| `POST /api/ai/outfits` | コーデ3案 | 登録した服の情報（写真なし）、条件、評価 |
| `POST /api/ai/purchases` | 買い足し提案 | 同上 |
| `POST /api/looks/photos` | 似た着こなしの写真（Pexels。Claudeは使わない） | 服の種類・色だけ（写真なし） |
| `GET /api/health` | 動作確認 | |

- 送られたデータは `src/ai/schemas.ts` の形で検査してから Claude に渡す
- Claude の返事は構造化出力（zodの形）で受け取り、アプリ側でも、持っていない服のIDや同じ種類の重複を含む案を捨てる
- 安全上の理由で断られた場合に別モデルへ切り替える `fallbacks: "default"` を付けている

## まだやっていないこと
- 中継サーバーの公開場所・認証（今は誰でも呼べる。公開前に、利用者を絞るしくみか回数制限が必要）
- 料金の目安の計測
- 実際の API キーでの動作確認（開発時はキーなしで型チェックと単体テストのみ）

## 新しいAIを足すとき
`ClosetAI` を実装したクラスを `src/ai/` に作り、`AIProviderId` と `createAI` に1行足す。
