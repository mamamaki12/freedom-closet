// 写真から服の色を取る。
// 背景を完全には取り除けないので、写真のふちの色を「背景」とみなし、
// それに近い画素を除いてから、残りを数色にまとめる。一番多い色が「地の色」、
// 2番目がはっきり違う色なら「柄・切り替えの色」とみなす。
import { nearestColorName, rgbToHex, rgbToLab } from "../../domain/colors";
import type { ColorName } from "../../domain/types";

type RGB = [number, number, number];

function dist2(a: number[], b: number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export interface ExtractedColor {
  name: ColorName;
  hex: string;
  rgb: RGB;
  lab: number[];
  /** 服の部分に占める割合（0〜1） */
  share: number;
}

export interface Palette {
  /** 面積の大きい順 */
  colors: ExtractedColor[];
  /** 2色以上がはっきり分かれている（柄・切り替え・ボーダーなど）とみなせるか */
  multiColor: boolean;
}

/** 2番目の色が服の 18% 以上を占め、1番目と見た目にはっきり違えば「2色以上」とみなす */
const SUB_MIN_SHARE = 0.18;
const SUB_MIN_DISTANCE = 22;

/** RGBA の画素列（canvas の getImageData と同じ並び）から代表色を求める */
export function dominantColor(data: Uint8ClampedArray, width: number, height: number): { name: ColorName; hex: string } {
  const { colors } = extractPalette(data, width, height);
  return { name: colors[0].name, hex: colors[0].hex };
}

/**
 * 服の部分の色を数色にまとめて、面積の大きい順に返す。
 * 柄ものは「地の色」と「柄の色」が分かれて出るので、2番目の色と multiColor を柄の手がかりにする。
 */
export function extractPalette(data: Uint8ClampedArray, width: number, height: number): Palette {
  const pixels = garmentPixels(data, width, height);
  if (pixels.length === 0) {
    const gray: ExtractedColor = { name: "gray", hex: "#9a9a9a", rgb: [154, 154, 154], lab: rgbToLab([154, 154, 154]), share: 1 };
    return { colors: [gray], multiColor: false };
  }
  const clusters = kmeans(pixels.map(rgbToLab), pixels, 4)
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  // 似た色のまとまりは1つにする（同じ色名で近い色は、照明のムラで分かれただけのことが多い）
  const merged: { rgb: RGB; lab: number[]; count: number }[] = [];
  for (const c of clusters) {
    const near = merged.find((m) => dist2(m.lab, c.lab) < 12 ** 2);
    if (near) {
      const total = near.count + c.count;
      near.rgb = [0, 1, 2].map((k) => (near.rgb[k] * near.count + c.rgb[k] * c.count) / total) as RGB;
      near.lab = rgbToLab(near.rgb);
      near.count = total;
    } else merged.push({ ...c });
  }
  const colors = merged.map((m) => ({
    name: nearestColorName(m.rgb),
    hex: rgbToHex(m.rgb),
    rgb: m.rgb,
    lab: m.lab,
    share: m.count / pixels.length,
  }));
  const [first, second] = colors;
  const multiColor =
    !!second && second.share >= SUB_MIN_SHARE && Math.sqrt(dist2(first.lab, second.lab)) >= SUB_MIN_DISTANCE && second.name !== first.name;
  return { colors, multiColor };
}

/** 背景（写真のふちの色）に近い画素を除いた、服の部分の画素 */
function garmentPixels(data: Uint8ClampedArray, width: number, height: number): RGB[] {
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
  return pixels;
}

/** Lab 空間で k-means を回し、まとまりごとの平均色（RGB）と画素数を返す */
function kmeans(labs: number[][], rgbs: RGB[], k: number): { rgb: RGB; lab: number[]; count: number }[] {
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
  return centers.map((_, j) => {
    const sum: RGB = [0, 0, 0];
    let cnt = 0;
    for (let i = 0; i < n; i++)
      if (assign[i] === j) {
        sum[0] += rgbs[i][0];
        sum[1] += rgbs[i][1];
        sum[2] += rgbs[i][2];
        cnt++;
      }
    const rgb: RGB = cnt ? [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt] : [0, 0, 0];
    return { rgb, lab: rgbToLab(rgb), count: cnt };
  });
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
