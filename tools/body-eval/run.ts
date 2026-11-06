// BodyM のキャッシュ（mediapipe_cache.py の出力）に、アプリの採寸コード（src/body/measure.ts）をそのまま当てて、
// 1人1行の JSONL を書き出す。採点は score.ts。
// 使い方: npx tsx tools/body-eval/run.ts <bodym_dir> <cache_dir> <split> [mp|gt] > out.jsonl（gt は切り抜きに正解のシルエットを使う）
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildScan, defaultScan, measureFront, measureSide, type Landmark, type Mask } from "../../src/body/measure";
import type { Profile } from "../../src/domain/profile";

const [bodymDir, cacheDir, split, maskKind = "mp"] = process.argv.slice(2);

function csv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
}
const hwg = new Map(csv(`${bodymDir}/${split}/hwg_metadata.csv`).map((r) => [r.subject_id, r]));
const meas = new Map(csv(`${bodymDir}/${split}/measurements.csv`).map((r) => [r.subject_id, r]));

interface View {
  width: number;
  height: number;
  landmarks: (Landmark & { z: number })[] | null;
}
function mask(photo: string, view: string, v: View, kind: string): Mask {
  const raw = gunzipSync(readFileSync(`${cacheDir}/${photo}_${view}.${kind}.gz`));
  const data = new Float32Array(raw.length);
  const k = kind === "gt" ? 1 : 1 / 255;
  for (let i = 0; i < raw.length; i++) data[i] = raw[i] * k;
  return { width: v.width, height: v.height, data, padding: 0.1 };
}

for (const f of readdirSync(cacheDir).filter((n) => n.endsWith(".json"))) {
  const rec = JSON.parse(readFileSync(`${cacheDir}/${f}`, "utf8"));
  const h = hwg.get(rec.subject)!;
  const profile: Profile = { heightCm: +h.height_cm, weightKg: +h.weight_kg, fit: h.gender === "female" ? "womens" : "mens" };
  const gt = Object.fromEntries(Object.entries(meas.get(rec.subject)!).filter(([k]) => k !== "subject_id").map(([k, v]) => [k, +v]));
  const out: Record<string, unknown> = { split, subject: rec.subject, photo: rec.photo, gender: h.gender, profile, gt, def: defaultScan(profile) };
  try {
    if (!rec.front?.landmarks) throw new Error("no person (front)");
    const front = measureFront(mask(rec.photo, "front", rec.front, maskKind), rec.front.landmarks);
    out.front = front;
    let side;
    try {
      if (!rec.side?.landmarks) throw new Error("no person (side)");
      side = measureSide(mask(rec.photo, "side", rec.side, maskKind), rec.side.landmarks, front);
      out.side = side;
    } catch (e) {
      out.sideError = String((e as Error).message);
    }
    out.scan = buildScan(front, side, 0);
  } catch (e) {
    out.error = String((e as Error).message);
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}
