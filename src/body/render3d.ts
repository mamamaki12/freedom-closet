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
  Layers,
  prepareFigure,
  THREE,
  type Paint,
} from "./model3d";
import { garmentMatte } from "./cutout";
import { loadShoe } from "./shoe";
import {
  columnSpans,
  erode,
  flattenLight,
  garmentMask,
  matteMask,
  planSwatches,
  pushPullFill,
  type PhotoKind,
} from "./photoMask";
import type { BodyScan } from "./types";

export type { PhotoKind };

// ---------- 服の写真から模様を作る ----------

/** 服の部分が写真のほどよい割合なら、切り抜きはうまくいっている */
function plausible(mask: Uint8Array, w: number, h: number): boolean {
  let c = 0;
  for (const v of mask) c += v;
  return c > w * h * 0.12 && c < w * h * 0.97;
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * 服の写真から、1枚貼る用（服の範囲いっぱいに、背景はまわりの服の色で埋める）と、
 * 敷き詰める用の生地の見本（胴・袖）を作る。
 * 切り抜きは端末の中の切り抜きAI（cutout.ts）。使えないときは写真のふちの色から決める。
 */
export async function garmentTextures(
  photo: Blob,
  color: string,
  opts: { kind?: PhotoKind; matte?: boolean } = {},
): Promise<Omit<Paint, "color">> {
  const kind = opts.kind ?? "upper";
  const bmp = await createImageBitmap(photo);
  const S = 192;
  const k = Math.min(1, S / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * k));
  const h = Math.max(8, Math.round(bmp.height * k));
  const small = canvasOf(w, h);
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(bmp, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);
  let mask: Uint8Array | undefined;
  if (opts.matte !== false) {
    const p = await garmentMatte(bmp, w, h).catch(() => undefined);
    if (p) {
      const m = matteMask(p, w, h);
      if (plausible(m, w, h)) mask = m;
    }
  }
  if (!mask) {
    const m = garmentMask(img);
    if (plausible(m, w, h)) mask = m;
  }
  const ok = !!mask;
  const plan = planSwatches(img, mask, kind);
  const [x0, x1, y0, y1] = plan.box;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;

  // 1枚貼る用：服の範囲を枠いっぱいに（縦横比は服の形＝3Dの側で決まるので、ここでは合わせない）。
  // 模様が細かく残るように元の写真から切り出し、背景は透明にしてから、まわりの服の色で埋める
  const whole = canvasOf(512, 640);
  const cut = canvasOf(whole.width, whole.height);
  const cctx = cut.getContext("2d")!;
  cctx.imageSmoothingQuality = "high";
  cctx.drawImage(bmp, x0 / k, y0 / k, bw / k, bh / k, 0, 0, cut.width, cut.height);
  const wctx = whole.getContext("2d", { willReadFrequently: true })!;
  wctx.imageSmoothingQuality = "high";
  if (ok) {
    // 切り抜きのふちには背景が 1 画素ほどまざるので、少し内側で切る
    const edge = erode(mask!, w, h, 1);
    const mc = canvasOf(w, h);
    const mctx = mc.getContext("2d")!;
    const md = mctx.createImageData(w, h);
    for (let i = 0; i < edge.length; i++) md.data[i * 4 + 3] = edge[i] ? 255 : 0;
    mctx.putImageData(md, 0, 0);
    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(mc, x0, y0, bw, bh, 0, 0, cut.width, cut.height);
    // 列ごとに、服が写っている上端〜下端を枠の高さいっぱいに伸ばす。
    // すその丸みやえりのくぼみで空く部分が出ないようにする。
    // ただし、服の高さの 4 分の 3 より短い列（ワンピースのすその広がり・袖）は伸ばさない（模様が縦に流れて見えるため）。
    // 空いたところは、あとでまわりの服の色で埋める
    const [top, bottom] = columnSpans(mask!, w, x0, x1, y0, y1);
    for (let dx = 0; dx < whole.width; dx++) {
      const X = Math.min(x1, x0 + Math.floor(((dx + 0.5) / whole.width) * bw));
      const span = bottom[X - x0] - top[X - x0] + 1;
      if (span < bh * 0.75) {
        wctx.drawImage(cut, dx, 0, 1, cut.height, dx, 0, 1, whole.height);
        continue;
      }
      const sy = ((top[X - x0] - y0) / bh) * cut.height;
      const sh = (span / bh) * cut.height;
      wctx.drawImage(cut, dx, sy, 1, sh, dx, 0, 1, whole.height);
    }
    // ふちの半透明のところは背景の色がまざっているので、透明にしてから埋める（服のまわりに白いふちが出ないように）
    const data = wctx.getImageData(0, 0, whole.width, whole.height);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = data.data[i] >= 240 ? 255 : 0;
    pushPullFill(data.data, whole.width, whole.height);
    wctx.putImageData(data, 0, 0);
  } else {
    wctx.fillStyle = color;
    wctx.fillRect(0, 0, whole.width, whole.height);
    wctx.drawImage(cut, 0, 0);
  }

  // 生地の見本が見つからない（切り抜きに失敗した）ときは、服の範囲の左上寄りの四角
  const short = Math.min(bw, bh);
  const bodySq = plan.body ?? {
    cx: (x0 + x1) / 2 - bw * 0.12,
    cy: y0 + bh * 0.3,
    side: short * 0.3,
    mean: undefined,
  };
  const sleeveSq = plan.sleeve;
  const swatchOf = (sq: { cx: number; cy: number; side: number }) => {
    const c = canvasOf(128, 128);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bmp,
      (sq.cx - sq.side / 2) / k,
      (sq.cy - sq.side / 2) / k,
      sq.side / k,
      sq.side / k,
      0,
      0,
      128,
      128,
    );
    // 光のむらをならす（折り返して並べたときに、ひし形の模様が出ないように）
    const d = ctx.getImageData(0, 0, 128, 128);
    flattenLight(d.data, 128, 18);
    ctx.putImageData(d, 0, 0);
    return c;
  };
  const swatch = swatchOf(bodySq);
  const sleeve = sleeveSq ? swatchOf(sleeveSq) : undefined;
  bmp.close();
  // 地の色：生地の見本の平均（背景は除く）
  const hex = (c: number[]) =>
    `#${c
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  const tone = ok && bodySq.mean ? hex(bodySq.mean) : undefined;
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return {
    whole: tex(whole),
    swatch: tex(swatch),
    sleeve: sleeve && tex(sleeve),
    bodyU: ok ? plan.bodyU : undefined,
    tone,
    tile: plan.refPx > 0 ? bodySq.side / plan.refPx : undefined,
    sleeveTile: sleeveSq && plan.refPx > 0 ? sleeveSq.side / plan.refPx : undefined,
  };
}

const paints = new WeakMap<Blob, Promise<Omit<Paint, "color">>>();

/** 服の写真から模様を作る（同じ写真は覚えておく） */
function paintFor(g: Garment): Promise<Paint> {
  const color = COLORS[g.color].hex;
  let p = paints.get(g.photo);
  if (!p) {
    const kind: PhotoKind =
      g.category === "shoes" ? "shoes" : g.category === "bottoms" ? "lower" : "upper";
    p = garmentTextures(g.photo, color, { kind }).catch(() => ({}));
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
  opts: { warp?: boolean; shoeModel?: boolean } = {},
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
  // 靴の3Dの型（スニーカー・革靴）。読み込めないときは足の形から作る
  if (opts.shoeModel !== false && items.some((g) => g.category === "shoes"))
    fig.shoe = await loadShoe().catch(() => undefined);
  const person = new THREE.Group();
  const shoes = items.find((g) => g.category === "shoes");
  const shoeShape = shoes && lookShape(shoes);
  person.add(
    buildBody(fig, {
      shoes: shoeShape?.kind === "shoes" ? shoeShape.style : undefined,
    }),
  );
  const sorted = [...items].sort(
    (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category),
  );
  // 下に着るものから順に着せ、上に着る服は下の服より外へ出す
  const layers = new Layers(fig.fit.marks.torsoCz);
  for (const g of sorted)
    person.add(buildGarment(fig, lookShape(g), await paintFor(g), layers));
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
