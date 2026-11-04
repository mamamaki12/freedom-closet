// 開発用：体の写真の読み取り（src/body）を、実在の人の体型データで採点するための窓口。
//   npx vite --port 5198  →  http://localhost:5198/tools/scan/eval.html
// window.scanPair({...}) で測った結果（JSON）を返す（Playwright から呼ぶ。tools/scan/eval-bodym.mjs）。
import { buildScan, measureFront, measureSide, type FrontMeasure, type Landmark, type Mask } from "../../src/body/measure";
import { detect } from "../../src/body/scan";

interface Req {
  /** 正面・横の写真（data URL） */
  front: string;
  side?: string;
  /** シルエット画像（白＝人）を、人を fg 色・背景を bg 色に塗り替えてから読ませる（白黒のままだと人が見つからないため） */
  recolor?: { fg: [number, number, number]; bg: [number, number, number] };
  /** 読み取りの切り抜きの代わりに、シルエット画像そのもの（recolor 前の白い部分）を切り抜きとして使う（読み取りロジックだけの誤差を見る） */
  useImageAsMask?: boolean;
}

interface Res {
  front: FrontMeasure;
  side?: ReturnType<typeof measureSide>;
  scan: ReturnType<typeof buildScan>;
  landmarks: { front: Landmark[]; side?: Landmark[] };
  /** 読み取った切り抜きと、シルエットの比較（useImageAsMask でなくても計算する） */
  maskIoU?: { front: number; side?: number };
  ms: { front: number; side?: number };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  return img;
}

/** 画像を描いた canvas（人の部分が白ければ、ついでに白い画素の一覧も返す） */
function draw(img: HTMLImageElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData } {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

/** シルエット画像（白＝人）を塗り替えた Blob と、人の部分（白）の2次元配列 */
async function prepare(url: string, recolor?: Req["recolor"]): Promise<{ blob: Blob; silhouette: Mask }> {
  const img = await loadImage(url);
  const { canvas, ctx, data } = draw(img);
  const w = canvas.width;
  const h = canvas.height;
  const sil = new Float32Array(w * h);
  const px = data.data;
  for (let i = 0; i < w * h; i++) {
    const on = px[i * 4] > 127 && px[i * 4 + 3] > 127;
    sil[i] = on ? 1 : 0;
    if (recolor) {
      const c = on ? recolor.fg : recolor.bg;
      px[i * 4] = c[0];
      px[i * 4 + 1] = c[1];
      px[i * 4 + 2] = c[2];
      px[i * 4 + 3] = 255;
    }
  }
  if (recolor) ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
  return { blob, silhouette: { width: w, height: h, data: sil } };
}

/**
 * 読み取り（detect）の切り抜きと同じ大きさ・余白で、シルエットを並べ直す。
 * detect は長辺 1280px に縮め、まわりに写真の 10% の余白を足す（失敗時は 1100px・25%）。
 */
function alignSilhouette(sil: Mask, mask: Mask): Mask | undefined {
  const pad = mask.padding ?? 0;
  const scale = Math.min(1, (pad === 0.25 ? 1100 : 1280) / Math.max(sil.width, sil.height));
  const w = Math.round(sil.width * scale);
  const h = Math.round(sil.height * scale);
  const mx = Math.round(w * pad);
  const my = Math.round(h * pad);
  if (w + 2 * mx !== mask.width || h + 2 * my !== mask.height) return undefined;
  const data = new Float32Array(mask.width * mask.height);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sil.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sil.width - 1, Math.floor(x / scale));
      data[(y + my) * mask.width + x + mx] = sil.data[sy * sil.width + sx];
    }
  }
  return { width: mask.width, height: mask.height, data, padding: pad };
}

function iou(a: Mask, b: Mask): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const p = a.data[i] > 0.5;
    const q = b.data[i] > 0.5;
    if (p && q) inter++;
    if (p || q) union++;
  }
  return union ? inter / union : 0;
}

async function read(url: string, req: Req): Promise<{ mask: Mask; landmarks: Landmark[]; iou?: number; ms: number }> {
  const { blob, silhouette } = await prepare(url, req.recolor);
  const t0 = performance.now();
  const r = await detect(blob);
  const ms = performance.now() - t0;
  const aligned = alignSilhouette(silhouette, r.mask);
  const score = aligned ? iou(r.mask, aligned) : undefined;
  if (req.useImageAsMask) {
    if (!aligned) throw new Error("シルエットを切り抜きの大きさに合わせられませんでした");
    return { mask: aligned, landmarks: r.landmarks, iou: score, ms };
  }
  return { mask: r.mask, landmarks: r.landmarks, iou: score, ms };
}

(window as unknown as { scanPair: (req: Req) => Promise<Res> }).scanPair = async (req) => {
  const f = await read(req.front, req);
  const front = measureFront(f.mask, f.landmarks);
  let side: Res["side"];
  let s: Awaited<ReturnType<typeof read>> | undefined;
  if (req.side) {
    s = await read(req.side, req);
    side = measureSide(s.mask, s.landmarks, front);
  }
  const scan = buildScan(front, side, 1);
  return {
    front,
    side,
    scan,
    landmarks: { front: f.landmarks, side: s?.landmarks },
    maskIoU: f.iou !== undefined ? { front: f.iou, side: s?.iou } : undefined,
    ms: { front: f.ms, side: s?.ms },
  };
};
(window as unknown as { ready: boolean }).ready = true;

/**
 * 写真1枚を読み取り（detect）、写真の座標に戻した骨格の点と切り抜き（0〜255、写真と同じ大きさ）を返す。
 * 余白（padding）を取り除き、点は写真の幅・高さに対する割合にする。
 */
(window as unknown as { detectPhoto: (url: string) => Promise<unknown> }).detectPhoto = async (url) => {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const [pw, ph] = [bmp.width, bmp.height];
  bmp.close();
  const r = await detect(blob);
  const pad = r.mask.padding ?? 0;
  const scale = Math.min(1, (pad === 0.25 ? 1100 : 1280) / Math.max(pw, ph));
  const w = Math.round(pw * scale);
  const h = Math.round(ph * scale);
  const mx = Math.round(w * pad);
  const my = Math.round(h * pad);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.round(Math.min(1, Math.max(0, r.mask.data[(y + my) * r.mask.width + x + mx] as number)) * 255);
  let bin = "";
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  const landmarks = r.landmarks.map((p) => ({ x: (p.x * r.mask.width - mx) / w, y: (p.y * r.mask.height - my) / h, visibility: p.visibility }));
  return { w, h, mask: btoa(bin), landmarks };
};
