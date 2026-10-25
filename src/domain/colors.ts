import type { ColorName } from "./types";

export interface ColorInfo {
  label: string;
  hex: string;
  /** 白・黒・グレー・ネイビー・ベージュなど、何にでも合わせやすい色 */
  neutral: boolean;
  /** 色相（度）。無彩色は null */
  hue: number | null;
}

export const COLORS: Record<ColorName, ColorInfo> = {
  black: { label: "黒", hex: "#1f1f1f", neutral: true, hue: null },
  white: { label: "白", hex: "#f7f7f5", neutral: true, hue: null },
  gray: { label: "グレー", hex: "#9a9a9a", neutral: true, hue: null },
  navy: { label: "ネイビー", hex: "#22305a", neutral: true, hue: 225 },
  blue: { label: "青", hex: "#2f6fd6", neutral: false, hue: 215 },
  lightblue: { label: "水色", hex: "#9cc7ea", neutral: false, hue: 205 },
  beige: { label: "ベージュ", hex: "#d8c3a0", neutral: true, hue: 38 },
  brown: { label: "茶", hex: "#7a5233", neutral: true, hue: 25 },
  khaki: { label: "カーキ", hex: "#8a8a55", neutral: true, hue: 60 },
  green: { label: "緑", hex: "#3c8a4e", neutral: false, hue: 135 },
  red: { label: "赤", hex: "#c8323a", neutral: false, hue: 355 },
  pink: { label: "ピンク", hex: "#eaa3b8", neutral: false, hue: 340 },
  yellow: { label: "黄", hex: "#e8c53a", neutral: false, hue: 48 },
  orange: { label: "オレンジ", hex: "#e47b30", neutral: false, hue: 25 },
  purple: { label: "紫", hex: "#7b4fa0", neutral: false, hue: 275 },
};

export function colorLabel(c: ColorName): string {
  return COLORS[c].label;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface HarmonyResult {
  /** -3〜+3 程度 */
  score: number;
  reasons: string[];
}

/**
 * 服の色の組み合わせを評価する。
 * 基本の考え方：差し色は1色まで、ほかはベーシックカラーでまとめると失敗しにくい。
 */
export function colorHarmony(colors: ColorName[]): HarmonyResult {
  const unique = [...new Set(colors)];
  const accents = unique.filter((c) => !COLORS[c].neutral);
  const reasons: string[] = [];
  let score = 0;

  if (accents.length === 0) {
    score += 1.5;
    const labels = unique.map(colorLabel).join("・");
    reasons.push(
      unique.length === 1
        ? `${labels}のワントーンで、すっきりまとまります。`
        : `${labels}のベーシックカラーでまとめているので、落ち着いた印象です。`,
    );
    if (unique.includes("black") && unique.includes("white")) {
      reasons.push("白と黒のメリハリがあるので、地味に見えにくい組み合わせです。");
    }
  } else if (accents.length === 1) {
    score += 2;
    reasons.push(`${colorLabel(accents[0])}を差し色にして、ほかをベーシックカラーでまとめています。`);
  } else if (accents.length === 2) {
    const [a, b] = accents.map((c) => COLORS[c].hue ?? 0);
    const d = hueDistance(a, b);
    if (d <= 40) {
      score += 1;
      reasons.push(`${colorLabel(accents[0])}と${colorLabel(accents[1])}は近い色なので、なじみやすい組み合わせです。`);
    } else if (d >= 150) {
      score -= 0.5;
      reasons.push(`${colorLabel(accents[0])}と${colorLabel(accents[1])}は反対の色なので、派手めになります。小物は無地がおすすめです。`);
    } else {
      score -= 1.5;
      reasons.push("色が多めなので、ちぐはぐに見えるかもしれません。");
    }
  } else {
    score -= 3;
    reasons.push("色数が多いので、まとまりにくい組み合わせです。");
  }

  return { score, reasons };
}

// --- 写真の色から一番近い色名を選ぶ ---

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB → CIE Lab（D65）。色の近さを人の見え方に近い形で測るため。 */
export function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * 見本の色に加えて、実際の服の写真で出やすい色も見本にする。
 * （サンプル写真で試したところ、濃いピンクが赤に、暗い赤が黒になりやすかった）
 */
const EXTRA_SAMPLES: [ColorName, string][] = [
  ["pink", "#d63c78"], // 濃いピンク
  ["red", "#6e1f2b"], // ボルドー（暗い赤）
  ["blue", "#3e5f8a"], // デニムの青
];

const PALETTE_LAB = [
  ...(Object.keys(COLORS) as ColorName[]).map((name) => ({ name, lab: rgbToLab(hexToRgb(COLORS[name].hex)) })),
  ...EXTRA_SAMPLES.map(([name, hex]) => ({ name, lab: rgbToLab(hexToRgb(hex)) })),
];

export function nearestColorName(rgb: [number, number, number]): ColorName {
  const lab = rgbToLab(rgb);
  let best: ColorName = "gray";
  let bestD = Infinity;
  for (const p of PALETTE_LAB) {
    const d = (lab[0] - p.lab[0]) ** 2 + (lab[1] - p.lab[1]) ** 2 + (lab[2] - p.lab[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  // 室内で撮ると、ネイビーは暗く写って黒に近くなる。青みがはっきりあればネイビーにする
  if (best === "black" && lab[2] <= -7) return "navy";
  return best;
}
