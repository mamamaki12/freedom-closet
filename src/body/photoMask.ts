// 服の写真の切り抜きと、模様づくりの計算（画面を使わない純粋な計算なので、テストできる）。
// 画像は左上から右へ並んだ画素の配列。mask は 1 が服、0 が背景。

const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface Shot {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 切り抜きAIの出力（服らしさ 0〜1）から服の範囲を決める。
 * 確かなところ（0.5以上）から始めて、つながっている「たぶん服」（0.2以上）まで広げる。
 * 白いボーダーの白い段のように、服の中で薄く出るところを取りこぼさないため。
 */
export function matteMask(p: Float32Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const mask = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++)
    if (p[i] >= 0.5) {
      mask[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] && p[j] >= 0.2) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  fillHoles(mask, w, h, n * 0.02);
  return cleanMask(mask, w, h, 2);
}

/** 服に囲まれた小さな穴（面積 maxArea 以下）を服にする。ふちにつながる背景はそのまま */
export function fillHoles(mask: Uint8Array, w: number, h: number, maxArea: number): void {
  const seen = new Uint8Array(w * h);
  const region: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] || seen[s]) continue;
    region.length = 0;
    region.push(s);
    seen[s] = 1;
    let border = false;
    for (let q = 0; q < region.length; q++) {
      const i = region[q];
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const [dx, dy] of NB) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!mask[j] && !seen[j]) {
          seen[j] = 1;
          region.push(j);
        }
      }
    }
    if (!border && region.length <= maxArea) for (const i of region) mask[i] = 1;
  }
}

/**
 * 写真のふち（背景）に近い色でつながっている部分を背景とみなす（切り抜きAIを使えないときの方法）。
 * 床や壁の上に置いて撮った写真なら、服の部分だけが残る。
 */
export function garmentMask(img: Shot): Uint8Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  // 背景の色：ふちの色の中央値
  const border: number[][] = [[], [], []];
  const push = (i: number) => {
    for (let c = 0; c < 3; c++) border[c].push(data[i * 4 + c]);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  const bg = border.map((arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]);
  const dist = (i: number, r: number, g: number, b: number) =>
    Math.hypot(data[i * 4] - r, data[i * 4 + 1] - g, data[i * 4 + 2] - b);
  // 服の色（真ん中あたりの中央値）が背景に近いときは、許す差を小さくして服を削りすぎないようにする
  const center: number[][] = [[], [], []];
  for (let y = Math.floor(h * 0.3); y < h * 0.7; y++)
    for (let x = Math.floor(w * 0.35); x < w * 0.65; x++)
      for (let c = 0; c < 3; c++) center[c].push(data[(y * w + x) * 4 + c]);
  const mid = center.map((arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)]);
  const contrast = Math.hypot(mid[0] - bg[0], mid[1] - bg[1], mid[2] - bg[2]);
  const TOL = Math.min(48, Math.max(12, contrast * 0.55));
  const NEAR = Math.min(12, TOL * 0.3);
  const isBg = new Uint8Array(n);
  const queue: number[] = [];
  const seed = (i: number) => {
    if (!isBg[i] && dist(i, bg[0], bg[1], bg[2]) < TOL) {
      isBg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  // 背景は少しずつ色が変わる（影・グラデーション）ので、となりの色に近ければ広げる
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (isBg[j]) continue;
      if (
        dist(j, bg[0], bg[1], bg[2]) < TOL ||
        (dist(j, r, g, b) < NEAR && dist(j, bg[0], bg[1], bg[2]) < TOL * 1.7)
      ) {
        isBg[j] = 1;
        queue.push(j);
      }
    }
  }
  // ハンガーに掛けた服は、えりとハンガーの間に背景が閉じ込められて残る。
  // 上のほう（上から1/4）にある、背景色のまとまった部分は背景にする（胸のロゴは下のほうなので消えない）
  const like = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!isBg[i] && dist(i, bg[0], bg[1], bg[2]) < TOL) like[i] = 1;
  const seen = new Uint8Array(n);
  for (let y = 0; y < h * 0.25; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!like[i] || seen[i]) continue;
      const region: number[] = [i];
      seen[i] = 1;
      for (let q = 0; q < region.length; q++) {
        const j = region[q];
        const jx = j % w;
        const jy = (j - jx) / w;
        for (const [dx, dy] of NB) {
          const nx = jx + dx;
          const ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (like[k] && !seen[k]) {
            seen[k] = 1;
            region.push(k);
          }
        }
      }
      if (region.length >= n * 0.004) for (const j of region) isBg[j] = 1;
    }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = isBg[i] ? 0 : 1;
  return cleanMask(mask, w, h, 2);
}

/** 縮める：半径 r の正方形の窓の中に背景が1つでもあれば背景にする（ふちから r だけ内側が残る） */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return squarePass(mask, w, h, r, 0);
}

/** 広げる：半径 r の正方形の窓の中に服が1つでもあれば服にする */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return squarePass(mask, w, h, r, 1);
}

/** 正方形の窓の中に値 hit があれば hit にする（横・縦に分けて計算する） */
function squarePass(src: Uint8Array, w: number, h: number, r: number, hit: 0 | 1): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let d = -r; d <= r; d++) {
        const nx = x + d;
        if (nx >= 0 && nx < w && src[y * w + nx] === hit) {
          v = hit;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let d = -r; d <= r; d++) {
        const ny = y + d;
        if (ny >= 0 && ny < h && tmp[ny * w + x] === hit) {
          v = hit;
          break;
        }
      }
      out[y * w + x] = v;
    }
  return out;
}

/**
 * 服の形を整える：細いもの（ハンガーの針金・糸くず）を消し、小さな切れ端を捨てる。
 * r は消す細さ（半径、ピクセル）。
 */
export function cleanMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // 縮めてから広げる（開く）
  const opened = dilate(erode(mask, w, h, r), w, h, r);
  // つながったかたまりごとに大きさを数え、いちばん大きいものの 1/4 未満は捨てる（靴は左右で2つなので残る）
  const label = new Int32Array(w * h).fill(-1);
  const areas: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < opened.length; i++) {
    if (!opened[i] || label[i] >= 0) continue;
    const id = areas.length;
    let area = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      area++;
      const x = j % w;
      const y = (j - x) / w;
      for (const [dx, dy] of NB) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (opened[k] && label[k] < 0) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
    areas.push(area);
  }
  const max = Math.max(0, ...areas);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] >= 0 && areas[label[i]] >= max * 0.25 ? 1 : 0;
  return out;
}

/** 服の範囲 [x0, x1, y0, y1]。端の、ほとんど服が写っていない行・列（ハンガーの残りなど）は含めない */
export function maskBox(mask: Uint8Array, w: number, h: number): [number, number, number, number] {
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    cols[x]++;
    rows[(i - x) / w]++;
  }
  const span = (arr: Float32Array): [number, number] => {
    let max = 0;
    for (const v of arr) max = Math.max(max, v);
    const th = max * 0.08;
    let a = 0;
    let b = arr.length - 1;
    while (a < b && arr[a] < th) a++;
    while (b > a && arr[b] < th) b--;
    return [a, b];
  };
  const [x0, x1] = span(cols);
  const [y0, y1] = span(rows);
  return [x0, x1, y0, y1];
}

/**
 * 列ごとの、服が写っている上端と下端（行番号）。細すぎる列（ハンガーの残りなど）はとなりの列の値を使い、
 * 全体を少しならして段差を消す。
 */
export function columnSpans(
  mask: Uint8Array,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): [Float32Array, Float32Array] {
  const n = x1 - x0 + 1;
  const top = new Float32Array(n).fill(NaN);
  const bottom = new Float32Array(n).fill(NaN);
  const minSpan = (y1 - y0 + 1) * 0.3;
  for (let x = x0; x <= x1; x++) {
    let a = -1;
    let b = -1;
    for (let y = y0; y <= y1; y++)
      if (mask[y * w + x]) {
        if (a < 0) a = y;
        b = y;
      }
    if (a >= 0 && b - a + 1 >= minSpan) {
      top[x - x0] = a;
      bottom[x - x0] = b;
    }
  }
  // 値のない列は、いちばん近い値のある列から
  const fill = (arr: Float32Array, fallback: number) => {
    let last = NaN;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(arr[i])) last = arr[i];
      else if (!Number.isNaN(last)) arr[i] = last;
    }
    last = NaN;
    for (let i = n - 1; i >= 0; i--) {
      if (!Number.isNaN(arr[i])) last = arr[i];
      else arr[i] = Number.isNaN(last) ? fallback : last;
    }
  };
  fill(top, y0);
  fill(bottom, y1);
  const smooth = (arr: Float32Array) => {
    const out = new Float32Array(n);
    const r = 3;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let c = 0;
      for (let d = -r; d <= r; d++) {
        const j = i + d;
        if (j < 0 || j >= n) continue;
        sum += arr[j];
        c++;
      }
      out[i] = sum / c;
    }
    return out;
  };
  return [smooth(top), smooth(bottom)];
}

/**
 * 写真の横方向のうち胴が写っている範囲（0〜1、服の範囲の中での割合）。
 * 列ごとに服が写っている高さを数え、真ん中から見て高さが半分以上ある列を胴とみなす（袖は低いので外れる）。
 * 片方の袖が胴にくっついて写っていると、そちら側だけ胴が広く見つかるので、
 * 左右の幅が大きく違うときは狭いほうにそろえる。
 */
export function bodyRange(
  mask: Uint8Array,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): [number, number] {
  const n = x1 - x0 + 1;
  const cols = new Float32Array(n);
  for (let x = x0; x <= x1; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) if (mask[y * w + x]) c++;
    cols[x - x0] = c;
  }
  let max = 0;
  for (const c of cols) max = Math.max(max, c);
  const th = max * 0.55;
  const mid = Math.floor(n / 2);
  let a = mid;
  let b = mid;
  while (a > 0 && cols[a - 1] >= th) a--;
  while (b < n - 1 && cols[b + 1] >= th) b++;
  const left = mid + 0.5 - a;
  const right = b + 0.5 - mid;
  if (left > right * 1.25) a = Math.round(mid + 0.5 - right);
  else if (right > left * 1.25) b = Math.round(mid - 0.5 + left);
  const u0 = a / n;
  const u1 = (b + 1) / n;
  // 胴がほとんど見つからない（細すぎる）ときは全体を使う
  if (u1 - u0 < 0.3) return [0, 1];
  return [u0, u1];
}

/** 服の部分の、行 y での横幅（ピクセル）。腰の幅を測るのに使う */
export function rowWidth(mask: Uint8Array, w: number, y: number, x0: number, x1: number): number {
  let a = -1;
  let b = -1;
  for (let x = x0; x <= x1; x++)
    if (mask[y * w + x]) {
      if (a < 0) a = x;
      b = x;
    }
  return a < 0 ? 0 : b - a + 1;
}

export interface Square {
  cx: number;
  cy: number;
  side: number;
  /** 四角の中の平均の色 [r, g, b] */
  mean: [number, number, number];
}

export interface Palette {
  /** 色の代表 [r, g, b] */
  centers: [number, number, number][];
  /** それぞれの色の割合（合計 1） */
  weight: number[];
  /** 服の「地」の色か（割合の大きい色。胸のプリント・ロゴ・ボタン・影の色は外れる） */
  main: boolean[];
}

type Box = [number, number, number, number];

/**
 * 服の部分の主な色を、色の近いもの同士でまとめて調べる（k-means、5色）。
 * 服全体に散らばっている色（服を 6×6 に分けたうちの 4 割以上の区画に出てくる色）と、3 割以上を占める色を
 * 「地」の色とする。ボーダーなら白と紺、花柄なら花の色も地の色になる。
 */
export function palette(
  mask: Uint8Array,
  img: Shot,
  box: Box,
  allow: (x: number) => boolean = () => true,
  K = 5,
): Palette | undefined {
  const { width: w, data } = img;
  const [x0, x1, y0, y1] = box;
  const G = 6;
  const pts: number[] = [];
  const cell: number[] = [];
  for (let y = y0; y <= y1; y += 2)
    for (let x = x0; x <= x1; x += 2) {
      const i = y * w + x;
      if (!mask[i] || !allow(x)) continue;
      pts.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      const gx = Math.min(G - 1, Math.floor(((x - x0) / (x1 - x0 + 1)) * G));
      const gy = Math.min(G - 1, Math.floor(((y - y0) / (y1 - y0 + 1)) * G));
      cell.push(gy * G + gx);
    }
  const n = pts.length / 3;
  if (n < 16) return undefined;
  // 始めの色：中央値と、すでに選んだ色からいちばん遠い色を順に
  const med = [0, 1, 2].map((c) => {
    const v: number[] = [];
    for (let i = 0; i < n; i++) v.push(pts[i * 3 + c]);
    return v.sort((p, q) => p - q)[Math.floor(n / 2)];
  });
  const centers: [number, number, number][] = [[med[0], med[1], med[2]]];
  const d2 = (i: number, c: number[]) =>
    (pts[i * 3] - c[0]) ** 2 + (pts[i * 3 + 1] - c[1]) ** 2 + (pts[i * 3 + 2] - c[2]) ** 2;
  while (centers.length < K) {
    let far = -1;
    let at = 0;
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (const c of centers) m = Math.min(m, d2(i, c));
      if (m > far) {
        far = m;
        at = i;
      }
    }
    if (far < 1) break;
    centers.push([pts[at * 3], pts[at * 3 + 1], pts[at * 3 + 2]]);
  }
  const k = centers.length;
  const owner = new Int32Array(n);
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = d2(i, centers[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      owner[i] = best;
      const s = sum[best];
      s[0] += pts[i * 3];
      s[1] += pts[i * 3 + 1];
      s[2] += pts[i * 3 + 2];
      s[3]++;
    }
    for (let c = 0; c < k; c++)
      if (sum[c][3] > 0) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const weight = new Array<number>(k).fill(0);
  // 区画ごとの、色ごとの画素の数
  const per = new Float32Array(G * G * k);
  const cellN = new Float32Array(G * G);
  for (let i = 0; i < n; i++) {
    weight[owner[i]] += 1 / n;
    per[cell[i] * k + owner[i]]++;
    cellN[cell[i]]++;
  }
  let cells = 0;
  const spread = new Array<number>(k).fill(0);
  const full = Math.max(...cellN);
  for (let g = 0; g < G * G; g++) {
    if (cellN[g] < full * 0.3) continue;
    cells++;
    for (let c = 0; c < k; c++) if (per[g * k + c] >= cellN[g] * 0.04) spread[c]++;
  }
  const main = weight.map((wt, c) => wt >= 0.3 || (cells > 0 && spread[c] / cells >= 0.4 && wt >= 0.03));
  // 念のため、いちばん多い色は必ず地の色にする
  main[weight.indexOf(Math.max(...weight))] = true;
  return { centers, weight, main };
}

/** いちばん近い色の番号と、その色までの距離 */
export function nearestColor(pal: Palette, r: number, g: number, b: number): [number, number] {
  let best = 0;
  let bd = Infinity;
  for (let c = 0; c < pal.centers.length; c++) {
    const [cr, cg, cb] = pal.centers[c];
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return [best, Math.sqrt(bd)];
}

/**
 * 範囲 allow の服の画素のうち、pal の地の色のどれとも違う（距離 tol より遠い）ものの割合。
 * 袖だけ色が違う服（袖だけ黒いラグランなど）を見分けるのに使う
 */
export function unlikeFraction(
  mask: Uint8Array,
  img: Shot,
  box: Box,
  pal: Palette,
  allow: (x: number) => boolean,
  tol = 40,
): number {
  const { width: w, data } = img;
  const [x0, x1, y0, y1] = box;
  let all = 0;
  let unlike = 0;
  for (let y = y0; y <= y1; y += 2)
    for (let x = x0; x <= x1; x += 2) {
      const i = y * w + x;
      if (!mask[i] || !allow(x)) continue;
      all++;
      let near = Infinity;
      for (let c = 0; c < pal.centers.length; c++) {
        if (!pal.main[c]) continue;
        const [cr, cg, cb] = pal.centers[c];
        near = Math.min(near, Math.hypot(data[i * 4] - cr, data[i * 4 + 1] - cg, data[i * 4 + 2] - cb));
      }
      if (near > tol) unlike++;
    }
  return all ? unlike / all : 0;
}

/** 背景の色：服でない画素の色の中央値。背景がほとんど写っていなければ undefined */
export function backgroundColor(mask: Uint8Array, img: Shot): [number, number, number] | undefined {
  const { data } = img;
  const v: number[][] = [[], [], []];
  for (let i = 0; i < mask.length; i += 3) {
    if (mask[i]) continue;
    for (let c = 0; c < 3; c++) v[c].push(data[i * 4 + c]);
  }
  if (v[0].length < 32) return undefined;
  const [r, g, b] = v.map((a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]);
  return [r, g, b];
}

/**
 * 生地の見本にする四角を選ぶ。服の部分だけでできていて（背景が入らないよう、服のふちから少し内側だけを使い、
 * 背景と同じ色の画素も使わない）、地の色だけでできているもの（胸のプリントやロゴ、ボタンを避ける）。
 * 色の平均が地の色全体の平均に近く、明るさのばらつきが同じ大きさの四角のふつうくらいのものを選ぶので、
 * ボーダーやチェックは模様ごと取れ、無地の服は折り目や影の少ないところが取れる。
 * allow(x) で使ってよい列をしぼる（袖だけ、胴だけなど）。prefer に近い四角を選びやすくする。
 * 大きい四角から試し、地の色以外がほとんど入らない四角がなければ小さくする。
 */
export function pickSquare(
  mask: Uint8Array,
  img: Shot,
  box: Box,
  sides: number[],
  opts: {
    allow?: (x: number) => boolean;
    prefer?: [number, number];
    inset?: number;
    background?: [number, number, number];
    /** 四角を置いてよい範囲（色を調べるのは box 全体）。えりの近くを避けるときなど */
    within?: Box;
  } = {},
): Square | undefined {
  const { width: w, height: h, data } = img;
  const [x0, x1, y0, y1] = opts.within ?? box;
  const allow = opts.allow ?? (() => true);
  const pal = palette(mask, img, box, allow);
  if (!pal) return undefined;
  // 服のふちは背景がまざりやすい（写真を縮めたときのにじみ・切り抜きのずれ）ので、内側だけを使う
  const inner = erode(mask, w, h, opts.inset ?? 2);
  // 背景と同じ色の画素（袖と胴のすき間など、切り抜きAIが服に含めてしまう細い背景）も使わない。
  // 服の地の色が背景に近いとき（白い服を白いシーツの上で撮ったなど）は見分けられないのでしない
  const bg = opts.background;
  let bgTol = 0;
  if (bg) {
    let near = Infinity;
    for (let c = 0; c < pal.centers.length; c++)
      if (pal.main[c]) {
        const [r, g, b] = pal.centers[c];
        near = Math.min(near, Math.hypot(r - bg[0], g - bg[1], b - bg[2]));
      }
    if (near > 60) bgTol = Math.min(40, near / 2);
  }
  // 画素ごとに：使える（服の内側で allow の列）か、明るさ、いちばん多い色と違うか
  const n = w * h;
  const usable = new Uint8Array(n);
  const unlike = new Uint8Array(n);
  const lum = new Float32Array(n);
  const heavy = pal.centers[pal.weight.indexOf(Math.max(...pal.weight))];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!inner[i] || !allow(x)) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      if (bgTol > 0 && Math.hypot(r - bg![0], g - bg![1], b - bg![2]) < bgTol) continue;
      usable[i] = 1;
      lum[i] = luma(data, i);
      const [c] = nearestColor(pal, r, g, b);
      if (pal.centers[c] !== heavy && Math.hypot(r - heavy[0], g - heavy[1], b - heavy[2]) > 30) unlike[i] = 1;
    }
  // 「地」でないところ：いちばん多い色と違う色の、大きなかたまり（胸のプリント・ロゴ・ワッペン・片側の影）。
  // 細いもの・小さいもの（ボーダーの段、チェックの線、総柄の小さな柄）は縮めると消えるので、地のうちに入る
  const odd = dilate(erode(unlike, w, h, 3), w, h, 3);
  const fine = new Uint8Array(n);
  const ref = [0, 0, 0];
  let refN = 0;
  for (let i = 0; i < n; i++) {
    if (!usable[i] || odd[i]) continue;
    fine[i] = 1;
    ref[0] += data[i * 4];
    ref[1] += data[i * 4 + 1];
    ref[2] += data[i * 4 + 2];
    refN++;
  }
  if (refN < 16) return undefined;
  for (let c = 0; c < 3; c++) ref[c] /= refN;
  // 明るさの段差（縫い目・ポケットのふち・袖と胴のすき間・折り目の線）。
  // 生地の織り目の細かいざらつきは拾わないよう、少しぼかしてから測り、服の中のふつうの段差の 3 倍より強いところを数える
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = luma(data, i);
  const soft = boxBlur(L, w, h, 1);
  const grad = new Float32Array(n);
  const gs: number[] = [];
  for (let y = Math.max(1, y0); y <= Math.min(h - 2, y1); y++)
    for (let x = Math.max(1, x0); x <= Math.min(w - 2, x1); x++) {
      const i = y * w + x;
      if (!usable[i]) continue;
      grad[i] = Math.hypot(soft[i + 1] - soft[i - 1], soft[i + w] - soft[i - w]);
      if ((x + y) % 2 === 0) gs.push(grad[i]);
    }
  gs.sort((p, q) => p - q);
  const edgeTh = Math.max(18, 3 * (gs[Math.floor(gs.length / 2)] ?? 0));
  const reach = Math.max(1, x1 - x0, y1 - y0);
  // 四角の中の合計をすぐ出せるように、左上からの累積（積分画像）を作る
  const W1 = w + 1;
  const layers = 8; // 使える, 地の色, 段差, r, g, b, 明るさ, 明るさの2乗
  const sat = new Float64Array(W1 * (h + 1) * layers);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = ((y + 1) * W1 + x + 1) * layers;
      const up = (y * W1 + x + 1) * layers;
      const left = ((y + 1) * W1 + x) * layers;
      const diag = (y * W1 + x) * layers;
      const u = usable[i];
      const v = [
        u,
        u && fine[i],
        u && grad[i] > edgeTh ? 1 : 0,
        u ? data[i * 4] : 0,
        u ? data[i * 4 + 1] : 0,
        u ? data[i * 4 + 2] : 0,
        u ? lum[i] : 0,
        u ? lum[i] * lum[i] : 0,
      ];
      for (let k = 0; k < layers; k++) sat[o + k] = v[k] + sat[up + k] + sat[left + k] - sat[diag + k];
    }
  const sum = (sx: number, sy: number, s: number, k: number) =>
    sat[((sy + s) * W1 + sx + s) * layers + k] -
    sat[(sy * W1 + sx + s) * layers + k] -
    sat[((sy + s) * W1 + sx) * layers + k] +
    sat[(sy * W1 + sx) * layers + k];
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  // 大きさごとにいちばんよい四角を選び、最後に大きさもくらべる（大きいほど敷き詰めたときのくり返しが目立たない）
  const results: { sq: Square; score: number }[] = [];
  const sizes = sides.map((v) => Math.max(4, Math.round(v)));
  const smallest = Math.min(...sizes);
  for (const s of sizes) {
    if (s > x1 - x0 + 1 || s > y1 - y0 + 1 || s > w || s > h) continue;
    const step = Math.max(1, Math.round(s / 6));
    const cands: { sq: Square; odd: number; spread: number; edge: number; far: number }[] = [];
    for (let sy = y0; sy + s - 1 <= y1; sy += step)
      for (let sx = x0; sx + s - 1 <= x1; sx += step) {
        const inside = sum(sx, sy, s, 0);
        if (inside < s * s * 0.99) continue;
        const ml = sum(sx, sy, s, 6) / inside;
        const cx = sx + s / 2;
        const cy = sy + s / 2;
        cands.push({
          sq: {
            cx,
            cy,
            side: s,
            mean: [sum(sx, sy, s, 3) / inside, sum(sx, sy, s, 4) / inside, sum(sx, sy, s, 5) / inside],
          },
          odd: 1 - sum(sx, sy, s, 1) / inside,
          spread: Math.sqrt(Math.max(0, sum(sx, sy, s, 7) / inside - ml * ml)),
          edge: sum(sx, sy, s, 2) / inside,
          far: opts.prefer ? Math.hypot(cx - opts.prefer[0], cy - opts.prefer[1]) / reach : 0,
        });
      }
    if (!cands.length) continue;
    // この大きさの四角の、ふつうの明るさのばらつきと段差の多さ（無地なら小さく、ボーダーなら大きい）。
    // ふつうより段差の多い四角（縫い目・ポケット・折り目が入っている）は強く避ける。
    // 「ふつう」は地の色だけでできた四角の中で決める（プリントの上の四角は段差が多く、基準がずれるため）
    const minOdd = Math.min(...cands.map((c) => c.odd));
    const plain = cands.filter((c) => c.odd <= Math.max(0.04, minOdd + 0.02));
    const typical = median(plain.map((c) => c.spread));
    const typicalEdge = median(plain.map((c) => c.edge));
    let best: { sq: Square; score: number } | undefined;
    for (const c of cands) {
      const [r, g, b] = c.sq.mean;
      const score =
        100 * c.odd +
        0.5 * Math.hypot(r - ref[0], g - ref[1], b - ref[2]) +
        0.6 * Math.abs(c.spread - typical) +
        150 * Math.max(0, c.edge - typicalEdge) +
        50 * Math.max(0, typicalEdge - c.edge) +
        12 * c.far;
      if (!best || score < best.score) best = { sq: c.sq, score };
    }
    // 大きい四角ほど少し有利に（一辺が倍で 4 点）
    results.push({ sq: best!.sq, score: best!.score - 4 * Math.log2(s / smallest) });
  }
  if (!results.length) return undefined;
  return results.reduce((p, q) => (q.score < p.score ? q : p)).sq;
}

function luma(data: Uint8ClampedArray, i: number) {
  return 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
}

/**
 * 生地の見本の明るさのむら（写真の光の当たり方・大きなしわ）をならす。
 * 見本を折り返して敷き詰めると、むらがひし形の模様になって目立つため。細かい織り目や柄は残す。
 */
export function flattenLight(px: Uint8ClampedArray, S: number, radius: number): void {
  const n = S * S;
  const L = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    L[i] = luma(px as Uint8ClampedArray, i);
    mean += L[i];
  }
  mean /= n;
  const low = boxBlur(L, S, S, radius);
  for (let i = 0; i < n; i++) {
    const k = Math.min(1.6, Math.max(0.6, mean / Math.max(1, low[i])));
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.min(255, px[i * 4 + c] * k);
  }
}

/** 正方形の窓での平均（ふちは折り返す） */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const mirror = (v: number, n: number) => {
    let m = v;
    while (m < 0 || m >= n) m = m < 0 ? -m - 1 : 2 * n - m - 1;
    return m;
  };
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * w + mirror(x + d, w)];
      tmp[y * w + x] = s / (2 * r + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[mirror(y + d, h) * w + x];
      out[y * w + x] = s / (2 * r + 1);
    }
  return out;
}

/**
 * 透明なところ（背景を消したところ）を、まわりの服の色でなめらかに埋める（押し出し・引き戻し）。
 * 1色で塗るより、すそや袖口のまわりが自然になる。px は RGBA、塗ったあとは不透明。
 */
export function pushPullFill(px: Uint8ClampedArray, w: number, h: number): void {
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    base.a[i] = a;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = px[i * 4 + k] * a;
  }
  // 縮める：重み（不透明さ）つきで4つずつまとめる。c は不透明さを掛けた色
  const levels: Level[] = [base];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const p = levels[levels.length - 1];
    const nw = Math.max(1, Math.ceil(p.w / 2));
    const nh = Math.max(1, Math.ceil(p.h / 2));
    const q: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let a = 0;
        const c = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(p.w - 1, x * 2 + dx);
            const sy = Math.min(p.h - 1, y * 2 + dy);
            const j = sy * p.w + sx;
            a += p.a[j];
            for (let k = 0; k < 3; k++) c[k] += p.c[j * 3 + k];
          }
        const o = y * nw + x;
        // 色は平均、不透明さは「どれか1つでも服なら服」に近づける
        const s = a > 0 ? 1 / a : 0;
        const na = Math.min(1, a);
        q.a[o] = na;
        for (let k = 0; k < 3; k++) q.c[o * 3 + k] = c[k] * s * na;
      }
    levels.push(q);
  }
  // 広げる：粗いほうの色を、足りない分だけ混ぜる
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l];
    const q = levels[l + 1];
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const o = y * p.w + x;
        const a = p.a[o];
        if (a >= 1) continue;
        // 粗いほうはなめらかに（4点の補間）
        const fx = Math.min(q.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const fy = Math.min(q.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const xa = Math.floor(fx);
        const ya = Math.floor(fy);
        const xb = Math.min(q.w - 1, xa + 1);
        const yb = Math.min(q.h - 1, ya + 1);
        const tx = fx - xa;
        const ty = fy - ya;
        for (let k = 0; k < 3; k++) {
          const at = (xx: number, yy: number) => {
            const j = yy * q.w + xx;
            return q.a[j] > 0 ? q.c[j * 3 + k] / q.a[j] : 0;
          };
          const v =
            (at(xa, ya) * (1 - tx) + at(xb, ya) * tx) * (1 - ty) +
            (at(xa, yb) * (1 - tx) + at(xb, yb) * tx) * ty;
          p.c[o * 3 + k] += v * (1 - a);
        }
        p.a[o] = 1;
      }
  }
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < 3; k++) px[i * 4 + k] = base.c[i * 3 + k];
    px[i * 4 + 3] = 255;
  }
}

/** 写真の服がどこに着るものか（生地の見本の選び方と、模様の大きさの基準が変わる） */
export type PhotoKind = "upper" | "lower" | "shoes";

/** 写真のどこを何に使うかの計画（すべて縮めた写真の画素で） */
export interface SwatchPlan {
  /** 服の範囲 [x0, x1, y0, y1] */
  box: Box;
  /** 横方向のうち胴（袖を除いた部分）の範囲（服の範囲の中での割合） */
  bodyU: [number, number];
  /** 模様の大きさの基準にする幅（トップスは胴の幅、ボトムスは腰の幅） */
  refPx: number;
  /** 胴（ボトムスは脚）の生地の見本 */
  body?: Square;
  /** 袖の生地の見本（袖の色が胴とはっきり違う服だけ） */
  sleeve?: Square;
}

/**
 * 服の写真（縮めたもの）と切り抜きから、生地の見本の四角と模様の大きさの基準を決める。
 * mask がなければ（切り抜きに失敗）、写真の真ん中あたりを服とみなす。
 */
export function planSwatches(
  img: Shot,
  mask: Uint8Array | undefined,
  kind: PhotoKind,
): SwatchPlan {
  const { width: w, height: h } = img;
  let [x0, x1, y0, y1] = mask
    ? maskBox(mask, w, h)
    : [Math.round(w * 0.14), Math.round(w * 0.86), Math.round(h * 0.1), Math.round(h * 0.9)];
  x1 = Math.max(x1, x0 + 3);
  y1 = Math.max(y1, y0 + 3);
  const box: Box = [x0, x1, y0, y1];
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const bodyU: [number, number] = mask ? bodyRange(mask, w, x0, x1, y0, y1) : [0, 1];
  const tx0 = x0 + bodyU[0] * bw;
  const tx1 = x0 + bodyU[1] * bw;
  const refPx =
    kind === "upper"
      ? (bodyU[1] - bodyU[0]) * bw
      : mask
        ? Math.max(bw * 0.3, rowWidth(mask, w, y0 + Math.round(bh * 0.08), x0, x1))
        : bw;
  const all = mask ?? new Uint8Array(w * h).fill(1);
  const short = Math.min(bw, bh);
  const inTorso = (x: number) => x >= tx0 && x <= tx1;
  const inSleeve = (x: number) => x < tx0 - 1 || x > tx1 + 1;
  const background = mask ? backgroundColor(mask, img) : undefined;
  const body = pickSquare(all, img, box, [0.3, 0.24, 0.18, 0.13, 0.09].map((f) => f * short), {
    allow: kind === "upper" ? inTorso : undefined,
    background,
    // トップスはえり・肩の縫い目を避ける（上の 14% は使わない）
    within: kind === "upper" ? [x0, x1, y0 + Math.round(bh * 0.14), y1] : undefined,
    prefer:
      kind === "upper"
        ? [tx0 + (tx1 - tx0) * 0.3, y0 + bh * 0.62]
        : kind === "lower"
          ? [x0 + bw * 0.3, y0 + bh * 0.5]
          : [x0 + bw / 2, y0 + bh / 2],
  });
  // 袖の色が胴とはっきり違う服（袖だけ黒いラグランなど）は、袖の見本を別に取る。
  // 袖の画素の半分以上が、胴の地の色のどれとも違うときだけ（ボーダーの紺の段だけを拾って誤らないように）
  const torsoPal = kind === "upper" && mask ? palette(all, img, box, inTorso) : undefined;
  const distinct = !!torsoPal && unlikeFraction(all, img, box, torsoPal, inSleeve) > 0.5;
  const sleeve = distinct
    ? pickSquare(all, img, box, [0.16, 0.12, 0.09].map((f) => f * short), {
        allow: inSleeve,
        background,
      })
    : undefined;
  return { box, bodyU, refPx, body, sleeve };
}
