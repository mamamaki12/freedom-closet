// 体の写真を端末の中だけで読み取る（MediaPipe Pose）。写真は外に送らず、読み終わったら捨てる。
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { measureFront, measureSide, ScanError, type FrontMeasure, type Landmark, type Mask } from "./measure";

/** 体の骨格と形を読む学習済みモデル（初回だけダウンロード。約9MB） */
const MODEL_URL =
  import.meta.env.VITE_POSE_MODEL ||
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

let landmarker: Promise<PoseLandmarker> | undefined;
/** GPU（WebGL）で動かす。CPU だと、写真によっては人の切り抜きで MediaPipe が内部で落ちるため（実在の写真34枚中19枚で起きた） */
let delegate: "GPU" | "CPU" = "GPU";

async function create(d: "GPU" | "CPU"): Promise<PoseLandmarker> {
  const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
  return PoseLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
      runningMode: "IMAGE",
      numPoses: 1,
      outputSegmentationMasks: true,
    },
  );
}

function load(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    if (delegate === "GPU") {
      try {
        return await create("GPU");
      } catch {
        // WebGL が使えない端末
        delegate = "CPU";
      }
    }
    return create("CPU");
  })().catch((e) => {
    landmarker = undefined;
    throw e;
  });
  return landmarker;
}

/**
 * 大きな写真は読み取り用に縮める（長辺 maxSide px）。
 * まわりに余白（写真のふちの色）を足す：人が端に近いと切り抜きがくるいやすいため。
 * 余白は人の部分ではないので、測る結果には影響しない。
 */
async function toCanvas(photo: Blob, maxSide: number, margin: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const mx = Math.round(w * margin);
  const my = Math.round(h * margin);
  const canvas = document.createElement("canvas");
  canvas.width = w + mx * 2;
  canvas.height = h + my * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, mx, my, w, h);
  bitmap.close();
  if (mx || my) {
    // ふちの色の平均で余白を塗る（白や黒だと人の切り抜きがくるうことがある）
    const edge = ctx.getImageData(mx, my, w, h).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const add = (i: number) => {
      r += edge[i];
      g += edge[i + 1];
      b += edge[i + 2];
      n++;
    };
    for (let x = 0; x < w; x += 4) {
      add(x * 4);
      add(((h - 1) * w + x) * 4);
    }
    for (let y = 0; y < h; y += 4) {
      add(y * w * 4);
      add((y * w + w - 1) * 4);
    }
    ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    ctx.fillRect(0, 0, canvas.width, my);
    ctx.fillRect(0, canvas.height - my, canvas.width, my);
    ctx.fillRect(0, 0, mx, canvas.height);
    ctx.fillRect(canvas.width - mx, 0, mx, canvas.height);
  }
  return canvas;
}

async function detectAt(photo: Blob, maxSide: number, margin: number): Promise<{ mask: Mask; landmarks: Landmark[] }> {
  const [pose, canvas] = await Promise.all([load(), toCanvas(photo, maxSide, margin)]);
  let result: ReturnType<PoseLandmarker["detect"]> | undefined;
  try {
    result = pose.detect(canvas);
    const landmarks = result.landmarks[0];
    const m = result.segmentationMasks?.[0];
    if (!landmarks || !m) throw new ScanError("写真の中に人が見つかりませんでした。明るい場所で、全身が写るように撮ってください");
    // 人とみなす境目は 0.6：背景のある実写真（正解の切り抜きつきの街の写真927枚）では、0.5 だと
    // 切り抜きが背景側に約1%はみ出した。採寸の式を合わせたシルエット（BodyM）ではずれがないので、条件をそろえる
    return { mask: { width: m.width, height: m.height, data: m.getAsFloat32Array(), padding: margin, threshold: 0.6 }, landmarks };
  } finally {
    result?.segmentationMasks?.forEach((x) => x.close());
    // 読み取りに使った画像を消す
    canvas.width = canvas.height = 0;
  }
}

/**
 * MediaPipe が内部で落ちたら（CPU で動いているときに写真によって起きる）、読み取りの部品を作り直し、
 * 余白を増やしてもう一度だけ試す。
 */
export async function detect(photo: Blob): Promise<{ mask: Mask; landmarks: Landmark[] }> {
  try {
    return await detectAt(photo, 1280, 0.1);
  } catch (e) {
    if (e instanceof ScanError) throw e;
    landmarker = undefined;
    try {
      return await detectAt(photo, 1100, 0.25);
    } catch (e2) {
      if (e2 instanceof ScanError) throw e2;
      landmarker = undefined;
      throw new ScanError("写真を読み取れませんでした。別の写真か、撮り直した写真で試してください");
    }
  }
}

export async function scanFront(photo: Blob): Promise<FrontMeasure> {
  const { mask, landmarks } = await detect(photo);
  return measureFront(mask, landmarks);
}

export async function scanSide(photo: Blob, front: FrontMeasure) {
  const { mask, landmarks } = await detect(photo);
  return measureSide(mask, landmarks, front);
}
