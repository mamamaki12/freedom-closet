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

function load(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
    return PoseLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "IMAGE",
        numPoses: 1,
        outputSegmentationMasks: true,
      },
    );
  })().catch((e) => {
    landmarker = undefined;
    throw e;
  });
  return landmarker;
}

/** 大きな写真は読み取り用に縮める（長辺1280px） */
async function toCanvas(photo: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function detect(photo: Blob): Promise<{ mask: Mask; landmarks: Landmark[] }> {
  const [pose, canvas] = await Promise.all([load(), toCanvas(photo)]);
  const result = pose.detect(canvas);
  const landmarks = result.landmarks[0];
  const m = result.segmentationMasks?.[0];
  try {
    if (!landmarks || !m) throw new ScanError("写真の中に人が見つかりませんでした。明るい場所で、全身が写るように撮ってください");
    return { mask: { width: m.width, height: m.height, data: m.getAsFloat32Array() }, landmarks };
  } finally {
    result.segmentationMasks?.forEach((x) => x.close());
    // 読み取りに使った画像を消す
    canvas.width = canvas.height = 0;
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
