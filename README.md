# freedom closet

服を1着ずつ撮って手持ちの服を管理し、コーデと買い足しを提案するWebアプリ（スマホのブラウザ向け）。

## できること（初期版）
- **服の登録**：写真を選ぶだけで、AIが種類と色を判定してそのまま登録する（アルバムから何枚でもまとめてOK）。種類が分からなかった写真だけ1回タップで選ぶ。違っていたらあとから直す
- **クローゼット**：登録した服を種類ごとに写真で見る・直す・削除。「この服でコーデ」でその服を使った案を見る
- **コーデ提案**：画面を開くとすぐ3案。体感の気温（寒い〜暑い）・目的・使いたい服はタップで変えるだけ。「ほかの案を見る」で別の3案。色合わせや袖・裾の扱いの説明つき
- **好き・好みじゃない**：評価は次の提案の順位に反映（好みじゃない組み合わせは出さない）
- **買い足し提案**：手持ちと合わせやすくコーデが増える服を、種類と色で提案。ユニクロ・GUの公式サイトの検索結果を開ける。画面を開くとすぐ提案する
- **AIの切り替え**：設定画面で「端末内AI」と「Claude API」を切り替え

写真と服の情報は端末内（IndexedDB）にだけ保存する。

## AIの切り替え
AIは `src/ai/types.ts` の `ClosetAI` という窓口に合わせて作ってあり、画面はこの窓口しか呼ばない。

| | 端末内AI（`local`） | Claude API（`claude`） |
| --- | --- | --- |
| 種類の判定 | Transformers.js＋CLIP（ゼロショット分類） | Claudeが写真を見て判定 |
| 色の判定 | 写真から代表色を計算 | Claudeが判定 |
| コーデ・買い足し | 独自の点数付け | Claudeが考える（写真は送らず、登録情報だけ送る） |
| 写真の送信 | しない | 判定時だけ、中継サーバー経由でAnthropicへ |

- 初期値は `.env` の `VITE_AI_PROVIDER`（`local` / `claude`）。アプリの設定画面でも切り替えられる
- Claudeモードで失敗したときは端末内AIで続ける（設定で切れる）
- 詳しくは [docs/ai-switching.md](docs/ai-switching.md)

## 動かし方
```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:5173
```

Claude APIモードも試すとき（別のターミナルで）：
```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev:server   # http://localhost:8787
```
APIキーは中継サーバーだけが持つ。`VITE_` で始まる変数に入れるとブラウザに埋め込まれるので入れない。

## 開発
```bash
npm test          # 単体テスト（点数付け・色の判定・Claude用の通信部分）
npm run typecheck
npm run build
```

## 構成
```
src/
  domain/      服・コーデの型、色の扱い
  ai/          AIの窓口（types.ts）と切り替え（index.ts）
    local/     端末内AI（種類判定・色の抽出・コーデと買い足しの点数付け）
    claude/    Claude API版（中継サーバーを呼ぶ）
    schemas.ts アプリと中継サーバーのやりとりの形（zod）
  shop/        ユニクロ・GUの検索リンク、手選びの商品リスト
  storage/     端末内の保存
  screens/     画面
server/        Claude API の中継サーバー
docs/          設計メモ
```

## 未確認のこと
- 端末内AIのモデル（`Xenova/clip-vit-base-patch32`）の判定精度と、iPhone Safariでの読込時間・メモリ。開発環境からモデルを取得できなかったため、実機で確認が必要
- GU の検索URL（`https://www.gu-global.com/jp/ja/search?q=`）が実際に開けるか
