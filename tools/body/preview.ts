// 開発用：3Dのマネキンと服を、いろいろな体型・服で並べて描く。
//   npx vite --port 5199  →  http://localhost:5199/tools/body/preview.html
// window.sheet([...]) で画像（data URL）を返す（Playwright から呼ぶ）。
import { defaultScan } from "../../src/body/measure";
import { buildScene, garmentTextures, snapshot } from "../../src/body/render3d";
import { bodyShape } from "../../src/domain/look";
import type { Profile } from "../../src/domain/profile";
import type { Garment } from "../../src/domain/types";

interface Item {
  label?: string;
  profile?: Profile;
  items?: {
    category: Garment["category"];
    subType: string;
    color: Garment["color"];
    photo: string;
  }[];
  angle?: number;
  /** 体型への変形をする（写真から作った体型のつもりで）。省略すると身長・体重だけの標準体型 */
  warp?: boolean;
  /** 影を消す（形の確認用） */
  noShadow?: boolean;
  width?: number;
  height?: number;
}

const blobs = new Map<string, Promise<Blob>>();
function photo(url: string): Promise<Blob> {
  let p = blobs.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.blob());
    blobs.set(url, p);
  }
  return p;
}

async function garments(items: Item["items"] = []): Promise<Garment[]> {
  return Promise.all(
    items.map(async (it, i) => ({
      id: `g${i}`,
      category: it.category,
      subType: it.subType,
      color: it.color,
      seasons: [],
      formality: 2,
      warmth: 2,
      createdAt: 0,
      photo: await photo(it.photo),
    })) as unknown as Promise<Garment>[],
  );
}

(window as unknown as { sheet: (items: Item[]) => Promise<string> }).sheet =
  async (items) => {
    const sheet = document.getElementById("sheet") as HTMLCanvasElement;
    const W = items[0]?.width ?? 300;
    const H = items[0]?.height ?? 560;
    sheet.width = W * items.length;
    sheet.height = H;
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = "#f3efe8";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const profile = it.profile ?? {};
      const scene = await buildScene(
        defaultScan(profile),
        await garments(it.items),
        bodyShape(profile).scale,
        profile,
        { warp: !!it.warp },
      );
      if (it.noShadow)
        scene.traverse(
          (o) => ((o as { castShadow?: boolean }).castShadow = false),
        );
      const url = await snapshot(scene, W, H, it.angle);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      ctx.drawImage(img, i * W, 0);
      ctx.fillStyle = "#333";
      ctx.font = "13px sans-serif";
      ctx.fillText(it.label ?? "", i * W + 8, 18);
    }
    return sheet.toDataURL("image/png");
  };
(window as unknown as { ready: boolean }).ready = true;

/** 服の写真から作った模様を並べて見る（背景の切り抜きの確認用） */
(
  window as unknown as { textures: (urls: string[]) => Promise<string> }
).textures = async (urls) => {
  const sheet = document.getElementById("sheet") as HTMLCanvasElement;
  const W = 160;
  sheet.width = W * urls.length;
  sheet.height = 200 + 64 + 170;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#f3efe8";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < urls.length; i++) {
    const blob = await photo(urls[i]);
    const t = await garmentTextures(blob, "#888888");
    const bmp = await createImageBitmap(blob);
    const k = Math.min(W / bmp.width, 170 / bmp.height);
    ctx.drawImage(bmp, i * W, 0, bmp.width * k, bmp.height * k);
    if (t.whole)
      ctx.drawImage(t.whole.image as HTMLCanvasElement, i * W, 175, 128, 160);
    if (t.bodyU) {
      ctx.strokeStyle = "#e0302a";
      ctx.beginPath();
      for (const u of t.bodyU) {
        ctx.moveTo(i * W + u * 128, 175);
        ctx.lineTo(i * W + u * 128, 335);
      }
      ctx.stroke();
    }
    if (t.swatch)
      ctx.drawImage(t.swatch.image as HTMLCanvasElement, i * W, 340, 64, 64);
  }
  return sheet.toDataURL("image/png");
};
