// 生地の見本を、くり返し並べてもつなぎ目が見えない模様（タイル）にする。
// 折り返して並べると、背中のまん中や袖で柄が左右対称に映り（プリントがボタンのように並ぶ・
// ボーダーが折れ曲がる）不自然なので、折り返さずにそのままくり返せる形にする。
//   1. ボーダーやチェックの傾きを測る（patternTilt）。見本はこの傾きを打ち消して取り直す
//   2. 見本の両端がいちばん似る長さ（柄のくり返しの長さの倍数）を探して、その長さで切る。
//      両端が重なるところは、両側がいちばん似ている道すじで切り替える（seamlessTile）

export interface Rgba {
  width: number;
  height: number;
  /** RGBA の順に 1 画素 4 つ */
  data: Uint8ClampedArray;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 傾きを直すのは、この角度まで（それより傾いた柄は、斜めの柄としてそのまま使う） */
const MAX_TILT = (15 * Math.PI) / 180;

/**
 * 柄のいちばん強い向き（ボーダーの線やチェックの線の傾き。右下がりが正、ラジアン）。
 * 角度を少しずつ変えながら、その向きの線に沿って明るさを平均し、平均の濃淡がいちばんはっきりする角度を探す
 * （横の線と縦の線の両方を数えるので、チェックは縦横の線がそろって傾いた角度になる）。
 * 向きのはっきりしない柄（花柄・無地）や、斜めの柄は 0
 */
export function patternTilt(img: Rgba): number {
  const { width: w, height: h, data } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rad = Math.min(w, h) / 2 - 1;
  // 見本のまん中の円の中だけ使う（四角のままだと、角度によって数える画素がかたよる）
  const xs: number[] = [];
  const ys: number[] = [];
  const vs: number[] = [];
  let mean = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > rad * rad) continue;
      const i = (y * w + x) * 4;
      const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      xs.push(dx);
      ys.push(dy);
      vs.push(v);
      mean += v;
    }
  const n = vs.length;
  if (n < 16) return 0;
  mean /= n;
  let total = 0;
  for (let k = 0; k < n; k++) {
    vs[k] -= mean;
    total += vs[k] * vs[k];
  }
  total /= n;
  if (total < 4) return 0;
  const R = Math.ceil(rad) + 2;
  const sa = new Float64Array(2 * R + 1);
  const ca = new Float64Array(2 * R + 1);
  const sb = new Float64Array(2 * R + 1);
  const cb = new Float64Array(2 * R + 1);
  /** 角度 t の横の線・縦の線に沿って平均したときの、濃淡のはっきりさ（線ごとの平均のばらつき） */
  const sharpness = (t: number) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    sa.fill(0);
    ca.fill(0);
    sb.fill(0);
    cb.fill(0);
    for (let k = 0; k < n; k++) {
      const a = Math.round(ys[k] * c - xs[k] * s) + R;
      const b = Math.round(xs[k] * c + ys[k] * s) + R;
      sa[a] += vs[k];
      ca[a]++;
      sb[b] += vs[k];
      cb[b]++;
    }
    let v = 0;
    for (let j = 0; j < sa.length; j++) {
      if (ca[j] > 0) v += (sa[j] * sa[j]) / ca[j];
      if (cb[j] > 0) v += (sb[j] * sb[j]) / cb[j];
    }
    return v / n;
  };
  const STEP = (0.5 * Math.PI) / 180;
  const steps = Math.round(MAX_TILT / STEP);
  const score: number[] = [];
  let best = 0;
  for (let j = -steps; j <= steps; j++) {
    score.push(sharpness(j * STEP));
    if (score[score.length - 1] > score[best]) best = score.length - 1;
  }
  const sorted = [...score].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const top = score[best];
  // はっきりした線の柄：線に沿った平均で濃淡の大半が説明でき、角度がずれると急にぼやける
  if (top < total * 0.2 || top < median * 1.5) return 0;
  // 探した角度のはしなら、もっと傾いた（斜めの）柄
  if (best === 0 || best === score.length - 1) return 0;
  // となりの角度との放物線で、細かい角度を求める
  const l = score[best - 1];
  const r = score[best + 1];
  const den = l - 2 * top + r;
  const off = den < 0 ? clamp((0.5 * (l - r)) / den, -0.5, 0.5) : 0;
  return (best - steps + off) * STEP;
}

function transpose(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = (x * h + y) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  return { width: h, height: w, data: out };
}

/**
 * 横にずらしたときの似ていなさ。長さ L ごとに、x と x+L の画素の差（重なる幅 n-L のぶん）を、
 * 関係のない2画素の差（色のばらつき）で割ったもの。小さいほど、L ずらすとよく重なる
 */
function shiftErrors(img: Rgba): { err: Float32Array; best: number; lmin: number; lmax: number } {
  const { width: n, height: h, data } = img;
  const mean = [0, 0, 0];
  for (let i = 0; i < n * h; i++) for (let c = 0; c < 3; c++) mean[c] += data[i * 4 + c];
  for (let c = 0; c < 3; c++) mean[c] /= n * h;
  let spread = 0;
  for (let i = 0; i < n * h; i++)
    for (let c = 0; c < 3; c++) spread += (data[i * 4 + c] - mean[c]) ** 2;
  spread = Math.max(1, (2 * spread) / (n * h));
  const omin = Math.max(4, Math.round(n * 0.06));
  const lmin = Math.round(n * 0.55);
  const lmax = n - omin;
  const err = new Float32Array(n + 1).fill(Infinity);
  let best = Infinity;
  for (let L = lmin; L <= lmax; L++) {
    const o = n - L;
    let s = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < o; x++) {
        const i = (y * n + x) * 4;
        const j = i + L * 4;
        s +=
          (data[i] - data[j]) ** 2 + (data[i + 1] - data[j + 1]) ** 2 + (data[i + 2] - data[j + 2]) ** 2;
      }
    err[L] = s / (o * h) / spread;
    best = Math.min(best, err[L]);
  }
  return { err, best, lmin, lmax };
}

/** 決まった長さでくり返す柄か（ボーダー・チェック・キルトなど。best がこれより小さい） */
const REPEATS = 0.35;

/** 横にくり返す長さ L を選ぶ（shiftErrors が小さいほど、両端がよく似ている） */
export function repeatLength(img: Rgba): number {
  const n = img.width;
  const { err, best, lmin, lmax } = shiftErrors(img);
  if (best < REPEATS) {
    // 柄がくり返している（ボーダー・チェック・無地）：よく合う長さのうち、いちばん長いもの
    for (let L = lmax; L >= lmin; L--) if (err[L] <= best + 0.06) return L;
  }
  // くり返しのない柄（花柄など）：重なりを広めに取り、切り替える道すじを選ぶ余地を作る
  const lo = Math.round(n * 0.7);
  const hi = Math.min(lmax, Math.round(n * 0.82));
  let L = hi;
  for (let c = lo; c <= hi; c++) if (err[c] < err[L]) L = c;
  return L;
}

/** 横方向に、つなぎ目なくくり返せる幅 L に切る */
function wrapX(img: Rgba): Rgba {
  const { width: n, height: h, data } = img;
  const L = repeatLength(img);
  const o = n - L;
  // 重なるところの、x と x+L の差
  const cost = new Float32Array(o * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < o; x++) {
      const i = (y * n + x) * 4;
      const j = i + L * 4;
      cost[y * o + x] =
        (data[i] - data[j]) ** 2 + (data[i + 1] - data[j + 1]) ** 2 + (data[i + 2] - data[j + 2]) ** 2;
    }
  // 上から下へ、差の合計がいちばん小さい切り替えの道すじ（1行で左右に1画素まで動ける）
  const acc = new Float32Array(o * h);
  const from = new Int8Array(o * h);
  for (let x = 0; x < o; x++) acc[x] = cost[x];
  for (let y = 1; y < h; y++)
    for (let x = 0; x < o; x++) {
      const up = (y - 1) * o + x;
      let b = acc[up];
      let d = 0;
      if (x > 0 && acc[up - 1] < b) {
        b = acc[up - 1];
        d = -1;
      }
      if (x < o - 1 && acc[up + 1] < b) {
        b = acc[up + 1];
        d = 1;
      }
      acc[y * o + x] = cost[y * o + x] + b;
      from[y * o + x] = d;
    }
  const cut = new Int32Array(h);
  let cx = 0;
  for (let x = 1; x < o; x++) if (acc[(h - 1) * o + x] < acc[(h - 1) * o + cx]) cx = x;
  for (let y = h - 1; y >= 0; y--) {
    cut[y] = cx;
    cx += from[y * o + cx];
  }
  // 道すじより左は、見本の右はし（x+L）の続き。右はそのまま。境目は2画素でなじませる
  const out = new Uint8ClampedArray(L * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < L; x++) {
      const a = x < o ? clamp((x - cut[y] + 1) / 2, 0, 1) : 1;
      const i = (y * n + x) * 4;
      const j = i + L * 4;
      const d = (y * L + x) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = a >= 1 ? data[i + c] : data[i + c] * a + data[j + c] * (1 - a);
    }
  return { width: L, height: h, data: out };
}

/** 見本を、縦横どちらにくり返してもつなぎ目が見えない模様にする（見本より少し小さくなる） */
export function seamlessTile(img: Rgba): Rgba {
  const a = wrapX(img);
  return transpose(wrapX(transpose(a)));
}

/**
 * 無地の生地の見本か：色みがほとんど変わらず、明るさのむらも小さく（しわや折り目の濃淡くらい）、
 * 縦にも横にも決まった長さでくり返さない（ボーダー・チェック・キルトではない）
 */
export function plainCloth(img: Rgba): boolean {
  const { width: w, height: h, data } = img;
  const n = w * h;
  let l = 0;
  let l2 = 0;
  let ca = 0;
  let cb = 0;
  let c2 = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    l += v;
    l2 += v * v;
    ca += r - g;
    cb += b - g;
    c2 += (r - g) ** 2 + (b - g) ** 2;
  }
  l /= n;
  ca /= n;
  cb /= n;
  const lumSpread = Math.sqrt(Math.max(0, l2 / n - l * l));
  const chroma = Math.sqrt(Math.max(0, c2 / n - ca * ca - cb * cb));
  // しわの濃淡は明るい生地ほど大きい（光の当たり方の割合なので）
  if (chroma > 8 || lumSpread > Math.max(14, l * 0.18)) return false;
  return shiftErrors(img).best >= REPEATS && shiftErrors(transpose(img)).best >= REPEATS;
}

/**
 * 生地の見本（つなぎ目なくくり返せる模様）の、しわや折り目の濃淡を弱める。無地の生地を敷き詰めると、
 * 同じしわがくり返して柄のように見えるため。明るさを、少しぼかした濃淡（しわ・折り目の線）と、
 * それより細かいざらつき（織り目）に分け、しわのほうを keep 倍にし、ざらつきの目立つ線もおさえる。
 * ぼかすときは、ふちを反対側につなげる（くり返したときに継ぎ目が出ないように）
 */
export function softenWrinkles(tile: Rgba, keep = 0.2): void {
  const { width: w, height: h, data } = tile;
  const n = w * h;
  const L = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    L[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    mean += L[i];
  }
  mean /= n;
  // 折り目の線は 2〜4 画素の幅なので、それより細かいざらつきだけを残す
  const R = 1;
  const tmp = new Float32Array(n);
  const low = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let t = 0;
      for (let d = -R; d <= R; d++) t += L[y * w + ((((x + d) % w) + w) % w)];
      tmp[y * w + x] = t / (2 * R + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let t = 0;
      for (let d = -R; d <= R; d++) t += tmp[((((y + d) % h) + h) % h) * w + x];
      low[y * w + x] = t / (2 * R + 1);
    }
  // 細かいざらつきのうち、ふつうより強いもの（縫い目の糸や折り目のふちの細い線）は、ふつうの強さまでにする
  const fine = new Float32Array(n);
  for (let i = 0; i < n; i++) fine[i] = Math.abs(L[i] - low[i]);
  const sorted = Float32Array.from(fine).sort();
  const cap = Math.max(2, sorted[Math.floor(n * 0.5)] * 3.5);
  for (let i = 0; i < n; i++) {
    const d = L[i] - low[i];
    const target = mean + (low[i] - mean) * keep + clamp(d, -cap, cap);
    const add = target - L[i];
    for (let c = 0; c < 3; c++) data[i * 4 + c] = clamp(data[i * 4 + c] + add, 0, 255);
  }
}
