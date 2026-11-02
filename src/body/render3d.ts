// 3Dのマネキンに服を着せた場面を作り、画像にしたり、指で回して見たりする。
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { COLORS } from "../domain/colors";
import { lookShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import type { Garment } from "../domain/types";
import {
  buildBody,
  buildGarment,
  prepareFigure,
  THREE,
  type Paint,
} from "./model3d";
import type { BodyScan } from "./types";

// ---------- 服の写真から模様を作る ----------

interface Shot {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 写真のふち（背景）に近い色でつながっている部分を背景とみなす。
 * 床や壁の上に置いて撮った写真なら、服の部分だけが残る。返り値は 1 が服。
 */
function garmentMask(img: Shot): Uint8Array {
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
  const bg = border.map(
    (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)],
  );
  const dist = (i: number, r: number, g: number, b: number) =>
    Math.hypot(data[i * 4] - r, data[i * 4 + 1] - g, data[i * 4 + 2] - b);
  // 服の色（真ん中あたりの中央値）が背景に近いときは、許す差を小さくして服を削りすぎないようにする
  const center: number[][] = [[], [], []];
  for (let y = Math.floor(h * 0.3); y < h * 0.7; y++)
    for (let x = Math.floor(w * 0.35); x < w * 0.65; x++)
      for (let c = 0; c < 3; c++) center[c].push(data[(y * w + x) * 4 + c]);
  const mid = center.map(
    (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)],
  );
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
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
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
  for (let i = 0; i < n; i++)
    if (!isBg[i] && dist(i, bg[0], bg[1], bg[2]) < TOL) like[i] = 1;
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
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
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

/**
 * 服の形を整える：細いもの（ハンガーの針金・糸くず）を消し、小さな切れ端を捨てる。
 * r は消す細さ（半径、ピクセル）。
 */
function cleanMask(mask: Uint8Array, w: number, h: number, r: number) {
  // 縮めてから広げる（開く）。正方形の窓なので横・縦に分けてできる
  const pass = (src: Uint8Array, keepIf: (hit: boolean) => boolean) => {
    const tmp = new Uint8Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hit = false;
        for (let d = -r; d <= r && !hit; d++) {
          const nx = x + d;
          if (nx >= 0 && nx < w && src[y * w + nx] === 0) hit = true;
        }
        tmp[y * w + x] = keepIf(hit) ? 1 : 0;
      }
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hit = false;
        for (let d = -r; d <= r && !hit; d++) {
          const ny = y + d;
          if (ny >= 0 && ny < h && tmp[ny * w + x] === 0) hit = true;
        }
        out[y * w + x] = keepIf(hit) ? 1 : 0;
      }
    return out;
  };
  const eroded = pass(mask, (hit) => !hit);
  // 広げるときは「0 が窓にない」ではなく「1 が窓にある」なので、反転して同じ処理を使う
  const inv = eroded.map((v) => 1 - v);
  const opened = pass(inv, (hit) => !hit).map((v) => 1 - v);
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
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
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
  for (let i = 0; i < out.length; i++)
    out[i] = label[i] >= 0 && areas[label[i]] >= max * 0.25 ? 1 : 0;
  return out;
}

/** 服の写真から、1枚貼る用（背景を服の色で塗りつぶし、服の範囲いっぱいに）と、敷き詰める用の模様を作る */
export async function garmentTextures(
  photo: Blob,
  color: string,
): Promise<Omit<Paint, "color">> {
  const bmp = await createImageBitmap(photo);
  const S = 192;
  const k = Math.min(1, S / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * k));
  const h = Math.max(8, Math.round(bmp.height * k));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(bmp, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);
  const mask = garmentMask(img);
  let count = 0;
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    count++;
    const x = i % w;
    cols[x]++;
    rows[(i - x) / w]++;
  }
  // 服の範囲。端の、ほとんど服が写っていない行・列（ハンガーの残りなど）は含めない
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
  let [x0, x1] = span(cols);
  let [y0, y1] = span(rows);
  const ok = count > w * h * 0.12 && count < w * h * 0.97;
  if (!ok) {
    x0 = Math.round(w * 0.14);
    x1 = Math.round(w * 0.86);
    y0 = Math.round(h * 0.1);
    y1 = Math.round(h * 0.9);
  } else {
    // 背景を透明にする（服の色で下塗りした上に重ねる）
    for (let i = 0; i < mask.length; i++) if (!mask[i]) img.data[i * 4 + 3] = 0;
    sctx.putImageData(img, 0, 0);
  }
  const bw = Math.max(4, x1 - x0 + 1);
  const bh = Math.max(4, y1 - y0 + 1);

  // 服の範囲を枠いっぱいに（縦横比は服の形＝3Dの側で決まるので、ここでは合わせない）。
  // 模様が細かく残るように元の写真から切り出し、背景は小さいほうで作ったマスクで透明にする
  const whole = document.createElement("canvas");
  whole.width = 512;
  whole.height = 640;
  const cut = document.createElement("canvas");
  cut.width = whole.width;
  cut.height = whole.height;
  const cctx = cut.getContext("2d")!;
  cctx.imageSmoothingQuality = "high";
  cctx.drawImage(
    bmp,
    x0 / k,
    y0 / k,
    bw / k,
    bh / k,
    0,
    0,
    cut.width,
    cut.height,
  );
  if (ok) {
    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(small, x0, y0, bw, bh, 0, 0, cut.width, cut.height);
  }
  const wctx = whole.getContext("2d")!;
  wctx.fillStyle = color;
  wctx.fillRect(0, 0, whole.width, whole.height);
  wctx.imageSmoothingQuality = "high";
  if (ok) {
    // 列ごとに、服が写っている上端〜下端を枠の高さいっぱいに伸ばす。
    // すその丸みやえりのくぼみで空く部分（下塗りの色）が出ないようにする
    const [top, bottom] = columnSpans(mask, w, x0, x1, y0, y1);
    for (let dx = 0; dx < whole.width; dx++) {
      const X = Math.min(x1, x0 + Math.floor(((dx + 0.5) / whole.width) * bw));
      const sy = ((top[X - x0] - y0) / bh) * cut.height;
      const sh = ((bottom[X - x0] - top[X - x0] + 1) / bh) * cut.height;
      wctx.drawImage(cut, dx, sy, 1, sh, dx, 0, 1, whole.height);
    }
  } else wctx.drawImage(cut, 0, 0);
  const bodyU = ok ? bodyRange(mask, w, x0, x1, y0, y1) : undefined;

  const swatch = document.createElement("canvas");
  swatch.width = swatch.height = 128;
  const side = Math.min(bw, bh) * 0.32;
  // 生地の見本は、服がいちばんしっかり写っている四角から取る（パンツの股の間や靴の間の床を避ける）。
  // 同じくらいなら真ん中の少し左（ボタンやファスナーを避ける）を選ぶ
  const [cx, cy] = ok
    ? swatchCenter(mask, w, x0, x1, y0, y1, side)
    : [(x0 + x1) / 2 - bw * 0.12, y0 + bh * 0.3];
  swatch
    .getContext("2d")!
    .drawImage(
      bmp,
      (cx - side / 2) / k,
      (cy - side / 2) / k,
      side / k,
      side / k,
      0,
      0,
      128,
      128,
    );
  bmp.close();
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { whole: tex(whole), swatch: tex(swatch), bodyU };
}

/** 一辺 side の四角のうち、服の写っている割合が高く、真ん中の少し左に近いものの中心 */
function swatchCenter(
  mask: Uint8Array,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  side: number,
): [number, number] {
  const half = side / 2;
  const px = (x0 + x1) / 2 - (x1 - x0) * 0.12;
  const py = (y0 + y1) / 2;
  const reach = Math.max(x1 - x0, y1 - y0) || 1;
  let best: [number, number] = [px, py];
  let bestScore = -Infinity;
  const steps = 9;
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const cx = x0 + half + ((x1 - x0 - side) * i) / (steps - 1);
      const cy = y0 + half + ((y1 - y0 - side) * j) / (steps - 1);
      let inside = 0;
      let total = 0;
      for (let y = Math.ceil(cy - half); y < cy + half; y += 2)
        for (let x = Math.ceil(cx - half); x < cx + half; x += 2) {
          total++;
          if (mask[y * w + x]) inside++;
        }
      const cover = total ? inside / total : 0;
      const near = 1 - Math.hypot(cx - px, cy - py) / reach;
      const score = cover * 4 + near;
      if (score > bestScore) {
        bestScore = score;
        best = [cx, cy];
      }
    }
  return best;
}

/**
 * 列ごとの、服が写っている上端と下端（行番号）。細すぎる列（ハンガーの残りなど）はとなりの列の値を使い、
 * 全体を少しならして段差を消す。
 */
function columnSpans(
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
 * 写真の横方向のうち胴が写っている範囲（0〜1）。
 * 列ごとに服が写っている高さを数え、真ん中から見て高さが半分以上ある列を胴とみなす（袖は低いので外れる）。
 */
function bodyRange(
  mask: Uint8Array,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): [number, number] {
  const cols = new Float32Array(x1 - x0 + 1);
  for (let x = x0; x <= x1; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) if (mask[y * w + x]) c++;
    cols[x - x0] = c;
  }
  let max = 0;
  for (const c of cols) max = Math.max(max, c);
  const th = max * 0.55;
  const mid = Math.floor(cols.length / 2);
  let a = mid;
  let b = mid;
  while (a > 0 && cols[a - 1] >= th) a--;
  while (b < cols.length - 1 && cols[b + 1] >= th) b++;
  const u0 = a / cols.length;
  const u1 = (b + 1) / cols.length;
  // 胴がほとんど見つからない（細すぎる）ときは全体を使う
  if (u1 - u0 < 0.3) return [0, 1];
  return [u0, u1];
}

const paints = new WeakMap<Blob, Promise<Omit<Paint, "color">>>();

/** 服の写真から模様を作る（同じ写真は覚えておく） */
function paintFor(g: Garment): Promise<Paint> {
  const color = COLORS[g.color].hex;
  let p = paints.get(g.photo);
  if (!p) {
    p = garmentTextures(g.photo, color).catch(() => ({}));
    paints.set(g.photo, p);
  }
  return p.then((t) => ({ ...t, color }));
}

// ---------- 場面 ----------

/** 重ね着の順（下に着るものから） */
const ORDER = ["shoes", "bottoms", "onepiece", "tops", "outer"];

/** scale は背の高さ（1で枠いっぱい）。低い人は小さく見える */
export async function buildScene(
  scan: BodyScan,
  items: Garment[],
  scale = 1,
  profile: Profile = {},
  opts: { warp?: boolean } = {},
): Promise<THREE.Scene> {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#b9ad9f", 0.7));
  const key = new THREE.DirectionalLight("#ffffff", 1.7);
  key.position.set(-1.1, 2.4, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 6;
  // 影の範囲は床に落ちる影まで入るように広めに（狭いと影が四角く切れる）
  key.shadow.camera.left = key.shadow.camera.bottom = -1.3;
  key.shadow.camera.right = key.shadow.camera.top = 1.3;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 8;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#ffffff", 0.6);
  rim.position.set(1.5, 1.4, -2);
  scene.add(rim);

  // 足もとの影（光の影と、やわらかい丸い影）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.ShadowMaterial({ opacity: 0.18 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 40),
    new THREE.MeshBasicMaterial({
      color: "#000000",
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.scale.set(1, 0.55, 1);
  blob.position.y = 0.001;
  scene.add(blob);

  const fig = await prepareFigure(scan, profile, opts);
  const person = new THREE.Group();
  person.add(
    buildBody(fig, { shoes: items.some((g) => g.category === "shoes") }),
  );
  const sorted = [...items].sort(
    (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
  );
  for (const g of sorted)
    person.add(buildGarment(fig, lookShape(g), await paintFor(g)));
  person.scale.setScalar(scale);
  scene.add(person);
  return scene;
}

/** angle はまわりから見る向き（0 が正面、ラジアン） */
export function camera(aspect: number, angle = 0.21): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(24, aspect, 0.1, 20);
  const r = 2.66;
  cam.position.set(Math.sin(angle) * r, 0.62, Math.cos(angle) * r);
  cam.lookAt(0, 0.5, 0);
  return cam;
}

let shared: THREE.WebGLRenderer | undefined;
const envs = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function setup(r: THREE.WebGLRenderer) {
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.VSMShadowMap;
  r.setClearColor(0x000000, 0);
}

/** 部屋の中のようなやわらかい光（映り込み）。描画装置ごとに1回だけ作る */
function environment(r: THREE.WebGLRenderer): THREE.Texture {
  let env = envs.get(r);
  if (!env) {
    const gen = new THREE.PMREMGenerator(r);
    env = gen.fromScene(new RoomEnvironment(), 0.04).texture;
    gen.dispose();
    envs.set(r, env);
  }
  return env;
}

/** 場面を1枚の画像（PNGのURL）にする。コーデの一覧で使う */
export async function snapshot(
  scene: THREE.Scene,
  width: number,
  height: number,
  angle?: number,
): Promise<string> {
  if (!shared) {
    shared = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    setup(shared);
  }
  scene.environment = environment(shared);
  scene.environmentIntensity = 0.55;
  shared.setPixelRatio(1);
  shared.setSize(width, height, false);
  shared.render(scene, camera(width / height, angle));
  return new Promise((resolve, reject) =>
    shared!.domElement.toBlob(
      (b) =>
        b
          ? resolve(URL.createObjectURL(b))
          : reject(new Error("画像にできませんでした")),
      "image/png",
    ),
  );
}

/** 指で回して見る。止めるときは返した関数を呼ぶ */
export function mountViewer(
  canvas: HTMLCanvasElement,
  scene: THREE.Scene,
): () => void {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  setup(renderer);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  scene.environment = environment(renderer);
  scene.environmentIntensity = 0.55;
  const cam = camera(1, 0);
  const controls = new OrbitControls(cam, canvas);
  controls.target.set(0, 0.5, 0);
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 4;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2.5;
  controls.addEventListener("start", () => (controls.autoRotate = false));
  let frame = 0;
  const loop = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (
      canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.round(h * renderer.getPixelRatio())
    ) {
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, cam);
    frame = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(frame);
    controls.dispose();
    renderer.dispose();
  };
}
