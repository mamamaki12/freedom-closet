// 服の写真から、服だけを切り抜く（端末の中で動く切り抜きAI）。
// モデルは U2-Netp（Apache-2.0、約4.6MB、アプリに同梱）。写真は外に送らない。
// 動かせない端末（古いブラウザなど）では undefined を返し、呼ぶ側は写真のふちの色から切り抜く方法を使う。
import type { InferenceSession, Tensor } from "onnxruntime-web";
import modelUrl from "./assets/u2netp.onnx?url";

/** モデルに入れる写真の大きさ（正方形） */
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type Ort = typeof import("onnxruntime-web");

let loading: Promise<{ ort: Ort; session: InferenceSession } | undefined> | undefined;

async function load(): Promise<{ ort: Ort; session: InferenceSession } | undefined> {
  // 服の判定（transformers.js）と同じ ONNX Runtime を使う。先に読み込むと、
  // wasm の置き場所などの設定が transformers.js と同じになる（同じものを2回ダウンロードしない）
  await import("@huggingface/transformers");
  const ort = (await import("onnxruntime-web/webgpu")) as unknown as Ort;
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`切り抜きのモデルを読み込めませんでした（${res.status}）`);
  const model = new Uint8Array(await res.arrayBuffer());
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
  for (const ep of gpu ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
      return { ort, session };
    } catch {
      // WebGPU で作れない端末は wasm（CPU）で
    }
  }
  return undefined;
}

function model() {
  if (!loading) {
    loading = load().catch(() => undefined);
    // 失敗したら次に呼ばれたときにもう一度試す
    loading.then((m) => {
      if (!m) loading = undefined;
    });
  }
  return loading;
}

/** モデルの入力：320x320 に縮め、いちばん明るい値で割ってから平均・ばらつきでそろえる（学習時と同じ） */
export function toInput(rgba: Uint8ClampedArray, n: number): Float32Array {
  let max = 1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    max = Math.max(max, rgba[o], rgba[o + 1], rgba[o + 2]);
  }
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / max - MEAN[c]) / STD[c];
  return out;
}

/** モデルの出力（0〜1 の服らしさ）を、いちばん低い値が0・高い値が1になるように広げる（学習時と同じ） */
export function normalize(p: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of p) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const d = Math.max(1e-6, hi - lo);
  return p.map((v) => (v - lo) / d);
}

/** S×S の値を w×h に引き伸ばす（なめらかに） */
export function resize(src: Float32Array, S: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(S - 1, Math.max(0, ((y + 0.5) / h) * S - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(S - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(S - 1, Math.max(0, ((x + 0.5) / w) * S - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(S - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * S + x0] * (1 - tx) + src[y0 * S + x1] * tx;
      const b = src[y1 * S + x0] * (1 - tx) + src[y1 * S + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * 写真の各点が服である確からしさ（0〜1）を w×h で返す。モデルを使えなければ undefined。
 * 1回目はモデルの読み込みに時間がかかる（同梱の約4.6MB。ONNX Runtime 本体は服の判定と共通）。
 */
export async function garmentMatte(
  photo: CanvasImageSource,
  w: number,
  h: number,
): Promise<Float32Array | undefined> {
  const m = await model();
  if (!m) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, 0, 0, SIZE, SIZE);
  const input = toInput(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE * SIZE);
  try {
    const feeds: Record<string, Tensor> = {
      [m.session.inputNames[0]]: new m.ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
    };
    const out = await m.session.run(feeds);
    const first = out[m.session.outputNames[0]];
    const data = (await first.getData()) as Float32Array;
    for (const t of Object.values(out)) t.dispose?.();
    return resize(normalize(data.slice(0, SIZE * SIZE)), SIZE, w, h);
  } catch {
    return undefined;
  }
}
