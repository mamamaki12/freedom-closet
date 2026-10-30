// 3Dのマネキンに服を着せた場面を作り、画像にしたり、指で回して見たりする。
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { COLORS } from "../domain/colors";
import { lookShape } from "../domain/look";
import type { Garment } from "../domain/types";
import { buildBody, buildGarment, THREE, type Paint } from "./model3d";
import type { BodyScan } from "./types";

/** 写真の一部を切り出してテクスチャにする */
async function cropTexture(photo: Blob, cx: number, cy: number, size: number): Promise<THREE.Texture> {
  const bmp = await createImageBitmap(photo);
  const side = Math.min(bmp.width, bmp.height) * size;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bmp, bmp.width * cx - side / 2, bmp.height * cy - side / 2, side, side, 0, 0, 256, 256);
  bmp.close();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const paints = new WeakMap<Blob, Promise<Omit<Paint, "color">>>();

/** 服の写真から模様を作る（同じ写真は覚えておく） */
function paintFor(g: Garment): Promise<Paint> {
  let p = paints.get(g.photo);
  if (!p) {
    p = Promise.all([cropTexture(g.photo, 0.5, 0.5, 0.72), cropTexture(g.photo, 0.32, 0.5, 0.2)])
      .then(([whole, swatch]) => ({ whole, swatch }))
      .catch(() => ({}));
    paints.set(g.photo, p);
  }
  return p.then((t) => ({ ...t, color: COLORS[g.color].hex }));
}

/** 重ね着の順（下に着るものから） */
const ORDER = ["shoes", "bottoms", "onepiece", "tops", "outer"];

/** scale は背の高さ（1で枠いっぱい）。低い人は小さく見える */
export async function buildScene(scan: BodyScan, items: Garment[], scale = 1): Promise<THREE.Scene> {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#b9ad9f", 1.6));
  const key = new THREE.DirectionalLight("#ffffff", 2.2);
  key.position.set(-1.2, 2.2, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#ffffff", 0.9);
  rim.position.set(1.5, 1.4, -2);
  scene.add(rim);

  // 足もとの影
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 40),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.12, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 0.55, 1);
  shadow.position.y = 0.001;
  scene.add(shadow);

  const person = new THREE.Group();
  person.add(buildBody(scan));
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  for (const g of sorted) person.add(buildGarment(scan, lookShape(g), await paintFor(g)));
  person.scale.setScalar(scale);
  scene.add(person);
  return scene;
}

function camera(aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(24, aspect, 0.1, 20);
  cam.position.set(0.55, 0.62, 2.6);
  cam.lookAt(0, 0.5, 0);
  return cam;
}

let shared: THREE.WebGLRenderer | undefined;

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
  r.toneMappingExposure = 1.05;
  r.setClearColor(0x000000, 0);
}

/** 場面を1枚の画像（PNGのURL）にする。コーデの一覧で使う */
export async function snapshot(scene: THREE.Scene, width: number, height: number): Promise<string> {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    setup(shared);
  }
  shared.setPixelRatio(1);
  shared.setSize(width, height, false);
  shared.render(scene, camera(width / height));
  return new Promise((resolve, reject) =>
    shared!.domElement.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("画像にできませんでした"))), "image/png"),
  );
}

/** 指で回して見る。止めるときは返した関数を呼ぶ */
export function mountViewer(canvas: HTMLCanvasElement, scene: THREE.Scene): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  setup(renderer);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const cam = camera(1);
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
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
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
