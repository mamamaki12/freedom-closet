// 写真から服の代表色を取る。
// 背景を完全には取り除けないので、写真のふちの色を「背景」とみなし、
// それに近い画素を除いてから、残りを数色にまとめて一番多い色を選ぶ。
import { nearestColorName, rgbToHex, rgbToLab } from "../../domain/colors";
import type { ColorName } from "../../domain/types";

type RGB = [number, number, number];

function dist2(a: number[], b: number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** RGBA の画素列（canvas の getImageData と同じ並び）から代表色を求める */
export function dominantColor(data: Uint8ClampedArray, width: number, height: number): { name: ColorName; hex: string } {
  const border: RGB[] = [];
  const inner: RGB[] = [];
  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const px: RGB = [data[i], data[i + 1], data[i + 2]];
      const onBorder = x < margin || y < margin || x >= width - margin || y >= height - margin;
      (onBorder ? border : inner).push(px);
    }

  // 背景の色（ふちの中央値）に近い画素を除く
  let pixels = inner;
  if (border.length > 0) {
    const med = (k: 0 | 1 | 2) => border.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(border.length / 2)];
    const bgLab = rgbToLab([med(0), med(1), med(2)]);
    const filtered = inner.filter((p) => dist2(rgbToLab(p), bgLab) > 15 ** 2);
    // ほとんど消えたら、服と背景が同じ色だったとみなして元に戻す
    if (filtered.length >= inner.length * 0.08) pixels = filtered;
  }
  if (pixels.length === 0) pixels = inner.length > 0 ? inner : border;
  if (pixels.length === 0) return { name: "gray", hex: "#9a9a9a" };

  const center = kmeansLargest(pixels.map(rgbToLab), pixels, 3);
  return { name: nearestColorName(center), hex: rgbToHex(center) };
}

/** Lab 空間で k-means を回し、一番大きいまとまりの平均色（RGB）を返す */
function kmeansLargest(labs: number[][], rgbs: RGB[], k: number): RGB {
  const n = labs.length;
  k = Math.min(k, n);
  // 決まった位置から初期値を取る（毎回同じ結果になるように）
  let centers = Array.from({ length: k }, (_, j) => labs[Math.floor(((j + 0.5) * n) / k)]);
  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = dist2(labs[i], centers[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      assign[i] = best;
    }
    centers = centers.map((c, j) => {
      const sum = [0, 0, 0];
      let cnt = 0;
      for (let i = 0; i < n; i++)
        if (assign[i] === j) {
          sum[0] += labs[i][0];
          sum[1] += labs[i][1];
          sum[2] += labs[i][2];
          cnt++;
        }
      return cnt ? sum.map((s) => s / cnt) : c;
    });
  }
  const counts = new Array<number>(k).fill(0);
  for (const a of assign) counts[a]++;
  const largest = counts.indexOf(Math.max(...counts));
  const sum: RGB = [0, 0, 0];
  let cnt = 0;
  for (let i = 0; i < n; i++)
    if (assign[i] === largest) {
      sum[0] += rgbs[i][0];
      sum[1] += rgbs[i][1];
      sum[2] += rgbs[i][2];
      cnt++;
    }
  return [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt];
}

/** 写真を小さく縮めて画素を取り出す（ブラウザ専用） */
export async function readPixels(photo: Blob, size = 64): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(photo);
  const scale = size / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を読み込めませんでした");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}
