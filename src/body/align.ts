// 生地の見本を、写真（1枚貼る用の模様 whole）の柄に重ねる。
// 3Dでは前は写真、背中は見本で、脇で写真から見本へ少しずつ切り替える。そこで柄がずれると、しまが二重にぼやける。
// 写真の服は平らに置かれていないので柄は少しずつ曲がっていて、見本を取ったところで合わせただけでは脇でずれる。
// そこで脇に近いところで、写真の柄と見本の柄がいちばん重なるずらし方を測って直す。
import type { Rgba } from "./tile";

/**
 * whole の座標から見本の座標への対応の表。whole の横を cols 等分した列のまん中（u = (k + 0.5) / cols）と、
 * 縦を rows - 1 等分した点（v = j / (rows - 1)）ごとに、見本の座標 [uv[i], uv[i + 1]]（i = (j * cols + k) * 2）
 */
export interface AlignGrid {
  cols: number;
  rows: number;
  uv: number[];
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const frac = (v: number) => v - Math.floor(v);

/** 表から、whole の座標 (u, v) の見本の座標（となりの点のあいだは直線でつなぐ。表の外は表のはしの延長） */
export function gridAt(g: AlignGrid, u: number, v: number): [number, number] {
  const f = u * g.cols - 0.5;
  const k = clamp(Math.floor(f), 0, g.cols - 2);
  const s = f - k;
  const e = v * (g.rows - 1);
  const j = clamp(Math.floor(e), 0, g.rows - 2);
  const t = e - j;
  const at = (kk: number, jj: number, c: number) => g.uv[(jj * g.cols + kk) * 2 + c];
  const out: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++)
    out[c] = lerp(lerp(at(k, j, c), at(k + 1, j, c), s), lerp(at(k, j + 1, c), at(k + 1, j + 1, c), s), t);
  return out;
}

/** 画像の座標 (u, v)（上が v = 1）の明るさ。repeat なら、はしをこえるとくり返す */
function sampler(img: Rgba, repeat: boolean) {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return (u: number, v: number) => {
    const fu = repeat ? frac(u) : clamp(u, 0, 1);
    const fv = repeat ? frac(v) : clamp(v, 0, 1);
    const x = Math.min(w - 1, Math.floor(fu * w));
    const y = Math.min(h - 1, Math.floor((1 - fv) * h));
    return lum[y * w + x];
  };
}

/** 明るさの並びから平均を引いたものと、その2乗の和（重なり具合＝正規化した相関を、何度も速く測るため） */
function centered(a: Float32Array): { a: Float32Array; aa: number } {
  let m = 0;
  for (const x of a) m += x;
  m /= a.length;
  const c = a.map((x) => x - m);
  let aa = 0;
  for (const x of c) aa += x * x;
  return { a: c, aa };
}

/**
 * 縦の点ごとの「ずらし方ごとの重なり具合」（ずらし方 q / steps。半分をこえると負のずらし方）から、
 * 重なり具合の合計が大きく、となりの点とのずらし方の差が小さく、ずらし方そのものも小さい並びを選ぶ（先頭から順に最良の道を求める）。
 * 柄がくり返すと、よく重なるずらし方がいくつもあるので、点ごとに選ぶと柄1つ分とびとびになる。となりとの差を数えると、
 * 写真の柄が少しずつ曲がっているのを追いかけられる。測れなかった点（undefined）は、となりの点につられる
 */
function track(curves: (Float32Array | undefined)[], steps: number, jump: number, prior: number): number[] {
  const shift = (q: number) => (q < steps / 2 ? q : q - steps) / steps;
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, steps - d) / steps;
  };
  const costs: Float64Array[] = [];
  const from: Int32Array[] = [];
  curves.forEach((c, j) => {
    const cost = new Float64Array(steps);
    const arg = new Int32Array(steps);
    for (let q = 0; q < steps; q++) {
      let best = 0;
      if (j > 0) {
        best = Infinity;
        for (let p = 0; p < steps; p++) {
          const v = costs[j - 1][p] + jump * gap(q, p);
          if (v < best) {
            best = v;
            arg[q] = p;
          }
        }
      }
      cost[q] = best - (c ? c[q] : 0) + prior * Math.abs(shift(q));
    }
    costs.push(cost);
    from.push(arg);
  });
  const n = curves.length;
  if (!n) return [];
  const last = costs[n - 1];
  let q = last.indexOf(Math.min(...last));
  const path: number[] = new Array(n);
  for (let j = n - 1; j >= 0; j--) {
    path[j] = q;
    q = from[j][q];
  }
  // 重なり具合のいちばん高いところを、となりのずらし方との放物線で細かく求める
  const fine = (j: number) => {
    const c = curves[j];
    if (!c) return 0;
    const q = path[j];
    const a = c[(q + steps - 1) % steps];
    const b = c[q];
    const d = c[(q + 1) % steps];
    const den = a - 2 * b + d;
    return den < 0 ? clamp((a - d) / (2 * den), -0.5, 0.5) / steps : 0;
  };
  // 柄1枚分をこえて曲がっていても、つながるように（となりとの差は半分まで）
  const out = [shift(path[0]) + fine(0)];
  for (let j = 1; j < n; j++) {
    let d = (path[j] - path[j - 1]) / steps;
    d -= Math.round(d);
    out.push(out[j - 1] + d + fine(j) - fine(j - 1));
  }
  return out;
}

/**
 * whole と見本の対応の表を作る。base は、見本を取ったところで合わせた対応（ずれを直す前）。
 * 胴の左右の脇（bodyU のはしから内へ 2〜20%）で、縦の点ごとに、見本を縦・横にどれだけずらすと写真の柄に
 * いちばん重なるかを測り（上から順に追いかける。track）、左半分には左の脇の、右半分には右の脇のずらし方を足す
 * （まん中でなめらかに切り替える。まん中は写真だけが見えるので、見本のずれは見えない）。
 * 柄がはっきりしない（重なり具合が測れない）ところは、となりにつられるか、ずらさない
 */
export function alignGrid(
  whole: Rgba,
  tile: Rgba,
  base: (u: number, v: number) => [number, number],
  bodyU: [number, number],
  cols = 32,
  rows = 17,
): AlignGrid {
  const uv: number[] = [];
  for (let j = 0; j < rows; j++)
    for (let k = 0; k < cols; k++) uv.push(...base((k + 0.5) / cols, j / (rows - 1)));
  const photo = sampler(whole, false);
  const cloth = sampler(tile, true);
  const span = bodyU[1] - bodyU[0];
  const bands: [number, number][] = [
    [bodyU[0] + span * 0.02, bodyU[0] + span * 0.2],
    [bodyU[1] - span * 0.2, bodyU[1] - span * 0.02],
  ];
  const SU = 8;
  const SV = 24;
  const STEPS = 48;
  // となりの点とのずらし方の差（見本1枚を 1 として）1 あたり、重なり具合をいくつ減らすか。
  // しま1本分（見本の 1/4 くらい）とぶと、重なり具合のはば（-1〜1）くらい減る
  const JUMP = 3;
  // ずらし方そのものの大きさ 1 あたり（見本を取ったところで合わせてあるので、ずれは小さいはず）
  const PRIOR = 0.3;
  const shiftOf = (q: number) => (q < STEPS / 2 ? q : q - STEPS) / STEPS;
  const shifts = bands.map(([ua, ub]) => {
    const windows = Array.from({ length: rows }, (_, j) => {
      const vc = j / (rows - 1);
      const half = 1.5 / (rows - 1);
      const va = clamp(vc - half, 0.03, 0.97);
      const vb = clamp(vc + half, 0.03, 0.97);
      const pts: [number, number][] = [];
      for (let a = 0; a < SU; a++)
        for (let b = 0; b < SV; b++) pts.push([lerp(ua, ub, (a + 0.5) / SU), lerp(va, vb, (b + 0.5) / SV)]);
      return {
        mid: (va + vb) / 2,
        P: centered(Float32Array.from(pts, ([u, v]) => photo(u, v))),
        at: Float64Array.from(pts.flatMap(([u, v]) => base(u, v))),
      };
    });
    /** ずらし方ごとの重なり具合（正規化した相関。-1〜1。柄がはっきりしなければ undefined） */
    const curve = (w: (typeof windows)[number], f: (q: number) => [number, number]) => {
      const c = new Float32Array(STEPS);
      const { a, aa } = w.P;
      const n = a.length;
      let top = -Infinity;
      let low = Infinity;
      for (let q = 0; q < STEPS; q++) {
        const [su, sv] = f(q);
        // 写真の側は平均を引いてあるので、見本の側は平均を引かずに掛けてよい
        let sb = 0;
        let bb = 0;
        let ab = 0;
        for (let i = 0; i < n; i++) {
          const y = cloth(w.at[i * 2] + su, w.at[i * 2 + 1] + sv);
          sb += y;
          bb += y * y;
          ab += a[i] * y;
        }
        const vb = bb - (sb * sb) / n;
        c[q] = aa > 1e-6 && vb > 1e-6 ? ab / Math.sqrt(aa * vb) : 0;
        top = Math.max(top, c[q]);
        low = Math.min(low, c[q]);
      }
      return top < 0.25 || top - low < 0.2 ? undefined : c;
    };
    // 縦のずれを追いかけてから、それに合わせて横のずれを追いかける（ボーダーは横にずらしても変わらないので、横はずらさない）
    const dv = track(windows.map((w) => curve(w, (q) => [0, shiftOf(q)])), STEPS, JUMP, PRIOR);
    const du = track(windows.map((w, j) => curve(w, (q) => [shiftOf(q), dv[j]])), STEPS, JUMP, PRIOR);
    const smooth3 = (a: number[]) => a.map((x, i) => (i === 0 || i === a.length - 1 ? x : (a[i - 1] + x + a[i + 1]) / 3));
    // 上下のはしの窓は、写真の外に出ないように内へ寄せてあるので、測ったところ（窓のまん中）から表の縦の点へ直す
    // （はしは、となりとの傾きで少しだけのばす）
    const mids = windows.map((w) => w.mid);
    const resample = (a: number[]) =>
      Array.from({ length: rows }, (_, j) => {
        const v = j / (rows - 1);
        let i = 0;
        while (i < rows - 2 && mids[i + 1] < v) i++;
        return lerp(a[i], a[i + 1], clamp((v - mids[i]) / (mids[i + 1] - mids[i]), -1, 2));
      });
    return [resample(smooth3(du)), resample(smooth3(dv))];
  });
  for (let j = 0; j < rows; j++)
    for (let k = 0; k < cols; k++) {
      const w = smooth(((k + 0.5) / cols - 0.4) / 0.2);
      for (let c = 0; c < 2; c++) uv[(j * cols + k) * 2 + c] += lerp(shifts[0][c][j], shifts[1][c][j], w);
    }
  return { cols, rows, uv };
}
