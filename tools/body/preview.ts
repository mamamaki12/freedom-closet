// 開発用：3Dのマネキンと服を、いろいろな体型・服で並べて描く。
//   npx vite --port 5199  →  http://localhost:5199/tools/body/preview.html
// window.sheet([...]) で画像（data URL）を返す（Playwright から呼ぶ）。

// 開発環境からは CDN（jsDelivr）に届かないことがあるので、ONNX Runtime の wasm は手元の node_modules から読む。
// アプリでは transformers.js の設定（CDN）のまま
ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
import * as ort from "onnxruntime-web/webgpu";
import { defaultScan } from "../../src/body/measure";
import { THREE } from "../../src/body/model3d";
import {
  buildScene,
  garmentTextures,
  snapshot,
  type PhotoKind,
} from "../../src/body/render3d";
import { bodyShape, type Neck } from "../../src/domain/look";
import type { Profile } from "../../src/domain/profile";
import type { Garment } from "../../src/domain/types";

interface Item {
  label?: string;
  profile?: Profile;
  items?: {
    category: Garment["category"];
    subType: string;
    color: Garment["color"];
    photo: string;
  }[];
  angle?: number;
  /** 体型への変形をする（写真から作った体型のつもりで）。省略すると身長・体重だけの標準体型 */
  warp?: boolean;
  /** 影を消す（形の確認用） */
  noShadow?: boolean;
  /** 模様を貼らず、面の材質ごとに色を塗る（形と貼り分けの確認用。0: 前、1: 背中など、2: 袖） */
  flat?: boolean;
  /** 材質を一部だけ変えて描く（見え方の原因を探す用） */
  tweak?: { sheen?: number; noMap?: boolean; roughness?: number; sheenFromMap?: boolean; sheenRoughness?: number };
  width?: number;
  height?: number;
  /** 一部を大きく見る（at を画面の中心に、scale 倍に） */
  zoom?: { at: [number, number, number]; scale: number; tilt?: number };
  /** 靴の3Dの型を使わず、足の形から作る（前の靴との比べ用） */
  oldShoes?: boolean;
  /** 肌をこの色で塗る（靴や服から体が飛び出していないかの確認用）。"hide" で体を消す */
  skin?: string;
}

const blobs = new Map<string, Promise<Blob>>();
function photo(url: string): Promise<Blob> {
  let p = blobs.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.blob());
    blobs.set(url, p);
  }
  return p;
}

async function garments(items: Item["items"] = []): Promise<Garment[]> {
  return Promise.all(
    items.map(async (it, i) => ({
      id: `g${i}`,
      category: it.category,
      subType: it.subType,
      color: it.color,
      seasons: [],
      formality: 2,
      warmth: 2,
      createdAt: 0,
      photo: await photo(it.photo),
    })) as unknown as Promise<Garment>[],
  );
}

(window as unknown as { sheet: (items: Item[]) => Promise<string> }).sheet =
  async (items) => {
    const sheet = document.getElementById("sheet") as HTMLCanvasElement;
    const W = items[0]?.width ?? 300;
    const H = items[0]?.height ?? 560;
    sheet.width = W * items.length;
    sheet.height = H;
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = "#f3efe8";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const profile = it.profile ?? {};
      const scene = await buildScene(
        defaultScan(profile),
        await garments(it.items),
        bodyShape(profile).scale,
        profile,
        { warp: !!it.warp, shoeModel: !it.oldShoes },
      );
      if (it.noShadow)
        scene.traverse(
          (o) => ((o as { castShadow?: boolean }).castShadow = false),
        );
      if (it.flat) {
        const tint = ["#d9a066", "#6fa8dc", "#93c47d"];
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && Array.isArray(m.material))
            m.material = m.material.map(
              (_, i) =>
                new THREE.MeshStandardMaterial({
                  color: tint[i] ?? "#cccccc",
                  roughness: 0.8,
                  side: THREE.DoubleSide,
                }),
            );
        });
      }
      if (it.tweak) {
        const tw = it.tweak;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !Array.isArray(m.material)) return;
          for (const mat of m.material as THREE.MeshPhysicalMaterial[]) {
            if (tw.sheen !== undefined) mat.sheen = tw.sheen;
            if (tw.roughness !== undefined) mat.roughness = tw.roughness;
            if (tw.sheenRoughness !== undefined) mat.sheenRoughness = tw.sheenRoughness;
            if (tw.sheenFromMap) mat.sheenColorMap = mat.map;
            if (tw.noMap) {
              mat.map = null;
              mat.color.set("#9a9a9a");
            }
            mat.needsUpdate = true;
          }
        });
      }
      if (it.skin) {
        const skin = new THREE.MeshBasicMaterial({ color: it.skin, visible: it.skin !== "hide" });
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !Array.isArray(m.material) && (m.material as THREE.MeshStandardMaterial).color?.getHexString() === "dcc8b6")
            m.material = skin;
        });
      }
      if (it.zoom) {
        const { at, scale, tilt = 0 } = it.zoom;
        // at を原点に移して、x 軸まわりに tilt だけ傾け（上から見るなど）、scale 倍して画面の中心へ
        const m = new THREE.Matrix4()
          .makeTranslation(0, 0.5, 0)
          .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
          .multiply(new THREE.Matrix4().makeRotationX(tilt))
          .multiply(new THREE.Matrix4().makeTranslation(-at[0], -at[1], -at[2]));
        scene.matrixAutoUpdate = false;
        scene.matrix.copy(m);
        scene.matrixWorldNeedsUpdate = true;
      }
      const url = await snapshot(scene, W, H, it.angle);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      ctx.drawImage(img, i * W, 0);
      ctx.fillStyle = "#333";
      ctx.font = "13px sans-serif";
      ctx.fillText(it.label ?? "", i * W + 8, 18);
    }
    return sheet.toDataURL("image/png");
  };
(window as unknown as { ready: boolean }).ready = true;

/** 服の写真から作った模様を並べて見る（背景の切り抜きの確認用）。写真の場所（フォルダー名）から服の種類を決める */
(
  window as unknown as {
    textures: (urls: string[], opts?: { matte?: boolean; neck?: Neck }) => Promise<string>;
  }
).textures = async (urls, opts = {}) => {
  const sheet = document.getElementById("sheet") as HTMLCanvasElement;
  const W = 160;
  sheet.width = W * urls.length;
  sheet.height = 175 + 165 + 70;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#f3efe8";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < urls.length; i++) {
    const kind: PhotoKind = /\/(pants|shorts|skirt)\//.test(urls[i])
      ? "lower"
      : /\/shoes\//.test(urls[i])
        ? "shoes"
        : "upper";
    const blob = await photo(urls[i]);
    const t = await garmentTextures(blob, "#888888", { kind, matte: opts.matte, neck: opts.neck });
    const bmp = await createImageBitmap(blob);
    const k = Math.min(W / bmp.width, 170 / bmp.height);
    ctx.drawImage(bmp, i * W, 0, bmp.width * k, bmp.height * k);
    if (t.whole)
      ctx.drawImage(t.whole.image as HTMLCanvasElement, i * W, 175, 128, 160);
    if (t.bodyU) {
      ctx.strokeStyle = "#e0302a";
      ctx.beginPath();
      for (const u of t.bodyU) {
        ctx.moveTo(i * W + u * 128, 175);
        ctx.lineTo(i * W + u * 128, 335);
      }
      ctx.stroke();
    }
    if (t.swatch)
      ctx.drawImage(t.swatch.image as HTMLCanvasElement, i * W, 340, 64, 64);
    if (t.sleeve)
      ctx.drawImage(t.sleeve.image as HTMLCanvasElement, i * W + 68, 340, 64, 64);
    ctx.fillStyle = "#333";
    ctx.font = "11px sans-serif";
    ctx.fillText(`tile ${t.tile?.map((v) => v.toFixed(2)).join("×") ?? "-"}`, i * W + 2, 406);
  }
  return sheet.toDataURL("image/png");
};
