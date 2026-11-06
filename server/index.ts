// Claude API の中継サーバー。アプリ（ブラウザ）からの依頼を受けて Claude を呼ぶ。
// 起動：ANTHROPIC_API_KEY=... npm run dev:server
// 受け方は app.ts、守り（どこから・どれだけ使えるか）は guard.ts。設定は .env.example と docs/ai-switching.md
import { analyzeRequestSchema, lookPhotosRequestSchema, outfitsRequestSchema, purchasesRequestSchema } from "../src/ai/schemas";
import { createRelay } from "./app";
import { analyzeGarment, MODEL, suggestOutfits, suggestPurchases } from "./claude";
import { configFromEnv } from "./guard";
import { searchLookPhotos } from "./photos";

const PORT = Number(process.env.PORT || 8787);
// 初期値はこのパソコンの中からだけ受ける（同じWi-Fiのほかの人から使われないように）。
// サーバーに置いて公開するときは HOST=0.0.0.0 にする
const HOST = process.env.HOST || "127.0.0.1";
const MB = 1024 * 1024;
const config = configFromEnv();

const server = createRelay(config, {
  // 写真はアプリで長辺768pxのJPEGに縮めてから送るので、ふつうは300KBもない
  "/api/ai/analyze": { schema: analyzeRequestSchema, handle: analyzeGarment, maxBody: 3.5 * MB, claude: true },
  "/api/ai/outfits": { schema: outfitsRequestSchema, handle: suggestOutfits, maxBody: 1 * MB, claude: true },
  "/api/ai/purchases": { schema: purchasesRequestSchema, handle: suggestPurchases, maxBody: 1 * MB, claude: true },
  "/api/looks/photos": { schema: lookPhotosRequestSchema, handle: (input) => searchLookPhotos(input), maxBody: 64 * 1024, claude: false },
});

server.listen(PORT, HOST, () => {
  console.log(`Claude中継サーバー: http://${HOST}:${PORT}（モデル: ${MODEL}）`);
  if (["127.0.0.1", "localhost", "::1"].includes(HOST)) return;
  if (!config.accessCode) {
    console.warn("注意：合言葉（RELAY_ACCESS_CODE）がないので、このサーバーのURLを知っている人ならだれでも使えます。公開するなら合言葉を決めてください");
  }
  if (config.allowedOrigins.length === 0) {
    console.warn("注意：ALLOWED_ORIGIN が空なので、ブラウザからは localhost のページしか使えません。アプリのURL（例：https://<ユーザー名>.github.io）を入れてください");
  }
});
