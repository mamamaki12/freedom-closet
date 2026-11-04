// コーデを着たときのイメージ（立体風のマネキンのイラスト）。
// 服の種類で形を描き分け、服の写真の真ん中あたりを生地の模様として貼り、陰影をつけて立体に見せる。
import { useId } from "react";
import { COLORS } from "../domain/colors";
import { bodyShape, lookShape, type LookShape, type Sleeve } from "../domain/look";
import type { Profile } from "../domain/profile";
import type { Garment } from "../domain/types";
import { usePhotoUrl } from "./common";

const CX = 70;

/** 足もとの高さ。背の高さはここを基準に大きさを変える */
const GROUND = 259;

interface Body {
  sw: number; // 肩幅の半分
  wa: number; // ウエストの半分
  hp: number; // 腰の半分
  arm: number; // 腕の太さの半分
  leg: number; // 脚の中心と体の中心の距離
  limb: number; // 脚の太さの倍率
}

function makeBody(profile: Profile): Body {
  const { width: w, belly, curvy } = bodyShape(profile);
  const hp = (curvy ? 21 : 20) * Math.max(w, (w + belly) / 2);
  return {
    sw: (curvy ? 22 : 25) * w,
    wa: (curvy ? 14 : 17) * belly,
    hp,
    arm: 5.5 * w,
    leg: hp * 0.47,
    limb: w,
  };
}

/** 角のある点 [x, y]、なめらかにつなぐ点 [x, y, true] */
type Pt = [number, number] | [number, number, true];
const f = (n: number) => n.toFixed(1);

/** 点をつないだ形。なめらかな点どうしのあいだは曲線にして、体の丸みを出す */
function path(pts: Pt[]): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  // 裾のように横にまっすぐ並ぶ2点は曲げない
  const linked = (a: Pt, b: Pt) => !!(a[2] && b[2]) && a[1] !== b[1];
  for (let i = 0; i < n; i++) {
    const [p1, p2] = [at(i), at(i + 1)];
    const p0 = linked(at(i - 1), p1) ? at(i - 1) : p1;
    const p3 = linked(p2, at(i + 2)) ? at(i + 2) : p2;
    if (linked(p1, p2)) {
      // Catmull-Rom を3次ベジェにする
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
    } else if (i < n - 1) d += `L${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}
const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y, smooth]) => (smooth ? [2 * CX - x, y, true] : [2 * CX - x, y]) as Pt).reverse();

/** 腕（袖）の形。t は肩(0)から手首(1)までのどこまで覆うか */
function armPath(b: Body, side: 1 | -1, t: number, loose: number): string {
  const c: Pt[] = [
    [CX + side * b.sw, 58],
    [CX + side * (b.sw + 5), 100],
    [CX + side * (b.sw + 8), 136],
  ];
  const at = (u: number): Pt => {
    const [p, q, k] = u <= 0.5 ? [c[0], c[1], u * 2] : [c[1], c[2], (u - 0.5) * 2];
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };
  const steps = [0, 0.25, 0.5, 0.75, 1].map((u) => u * t);
  const r = (u: number) => b.arm + loose - u * 2;
  const outer = steps.map((u) => [at(u)[0] + side * r(u), at(u)[1]] as Pt);
  const inner = steps.map((u) => [at(u)[0] - side * r(u), at(u)[1] + (u === 0 ? 10 : 0)] as Pt).reverse();
  return path([[CX + side * (b.sw - 4), 54], ...outer, ...inner]);
}

const SLEEVE_T: Record<Sleeve, number> = { none: 0, short: 0.32, long: 1 };

/** 胴体の服（トップス・アウター・ワンピース）。half は前開きの片側だけ描くとき */
function torsoPath(b: Body, hemY: number, loose: number, hemFlare: number, half?: 1 | -1): string {
  const left: Pt[] = [
    [CX - 7, 49],
    [CX - b.sw - loose, 56],
    [CX - b.sw + 3 - loose, 74, true],
    // おなかまわり（体重が重めだと横に張り出す）
    [CX - Math.max((b.sw - 3 + b.wa + 1) / 2, b.wa + 2) - loose, 92, true],
    [CX - b.wa - loose - 1, 110, true],
    [CX - b.hp - loose - hemFlare, Math.max(hemY, 112), true],
  ];
  if (!half) return path([...left, ...mirror(left)]);
  const gap = 3;
  const side = half === -1 ? left : mirror(left).reverse();
  return path([...side, [CX + half * gap, hemY], [CX + half * gap, 56]]);
}

function legsPath(b: Body, s: Extract<LookShape, { kind: "pants" }>): string {
  const end = s.length === "short" ? 168 : 246;
  const half = (s.length === "short" ? 12 : s.width === "wide" ? 13 : s.width === "slim" ? 5.5 : 7.5) * b.limb;
  const left: Pt[] = [
    [CX - b.wa - 1, 108],
    [CX - b.hp - 1, 128],
    [CX - b.leg - half - (s.width === "wide" ? 2 : 0), end],
    [Math.min(CX - b.leg + half, CX - 1.5), end],
    [CX, 142],
  ];
  return path([...left, ...mirror(left).slice(1)]);
}

function skirtPath(b: Body, length: "mini" | "knee" | "long", top = 108): string {
  const [hem, flare] = length === "mini" ? [152, 6] : length === "knee" ? [196, 10] : [236, 14];
  const left: Pt[] = [
    [CX - b.wa - 1, top],
    [CX - b.hp - 1, 128],
    [CX - b.hp - flare, hem],
  ];
  return path([...left, ...mirror(left)]);
}

/** 靴。足の先だけ（ブーツは脛まで） */
function shoePaths(b: Body, style: Extract<LookShape, { kind: "shoes" }>["style"]): string[] {
  return ([-1, 1] as const).map((side) => {
    const x = CX + side * b.leg;
    const top = style === "boots" ? 206 : style === "sandals" ? 250 : 243;
    const w = style === "boots" ? 7.5 : 8;
    return path([
      [x - w, top],
      [x + w, top],
      [x + w + 1.5 + side * 1.5, 255],
      [x + w + side * 2, 259],
      [x - w + side * 2, 259],
      [x - w - 1.5 + side * 1.5, 255],
    ]);
  });
}

interface Layer {
  garment: Garment;
  paths: string[];
  /** 縫い目やダウンの線などの飾り */
  lines?: string[];
  /** 写真の貼り方。whole は真ん中を1枚の布として、swatch は脚のあたりの生地を小さく切って敷き詰める */
  texture: "whole" | "swatch" | "none";
}

function layersFor(items: Garment[], b: Body): Layer[] {
  const layers: Layer[] = [];
  const add = (g: Garment, paths: string[], lines?: string[], texture: Layer["texture"] = "whole") =>
    layers.push({ garment: g, paths, lines, texture });
  const order = ["bottoms", "shoes", "onepiece", "tops", "outer"];
  const sorted = [...items].sort((a, b2) => order.indexOf(a.category) - order.indexOf(b2.category));
  for (const g of sorted) {
    const s = lookShape(g);
    switch (s.kind) {
      case "pants":
        // パンツの写真の真ん中は脚のあいだの床が写るので、片脚の生地を敷き詰める
        add(g, [legsPath(b, s)], [`M${CX},112L${CX},140`], "swatch");
        break;
      case "skirt":
        add(g, [skirtPath(b, s.length)]);
        break;
      case "shoes":
        add(g, shoePaths(b, s.style), undefined, "none");
        break;
      case "dress": {
        const t = SLEEVE_T[s.sleeve];
        add(g, [
          ...(t ? [armPath(b, -1, t, 1.5), armPath(b, 1, t, 1.5)] : []),
          torsoPath(b, 112, 0.5, 0),
          skirtPath(b, s.length === "long" ? "long" : "knee", 110),
        ]);
        break;
      }
      case "top": {
        const t = SLEEVE_T[s.sleeve];
        const hem = s.hem === "short" ? 112 : s.hem === "long" ? 152 : 134;
        add(
          g,
          [...(t ? [armPath(b, -1, t, 1.5), armPath(b, 1, t, 1.5)] : []), torsoPath(b, hem, 1, 1)],
          [`M${CX - 7},49Q${CX},${s.sleeve === "long" && /ニット|スウェット|パーカー/.test(g.subType) ? 53 : 57} ${CX + 7},49`],
        );
        break;
      }
      case "outer": {
        const hem = s.length === "short" ? 140 : s.length === "middle" ? 178 : 206;
        const loose = s.puffy ? 5 : 3;
        const flare = s.length === "short" ? 1 : 5;
        const lines = s.puffy
          ? [76, 96, 116, 136]
              .filter((y) => y < hem)
              .map((y) => `M${CX - b.sw - 4},${y}L${CX - 4},${y + 2}M${CX + 4},${y + 2}L${CX + b.sw + 4},${y}`)
          : [`M${CX - 3},56L${CX - 12},74L${CX - 3},92`, `M${CX + 3},56L${CX + 12},74L${CX + 3},92`];
        add(
          g,
          [
            ...(s.sleeve === "none" ? [] : [armPath(b, -1, 1, 1.5 + loose), armPath(b, 1, 1, 1.5 + loose)]),
            torsoPath(b, hem, loose, flare, -1),
            torsoPath(b, hem, loose, flare, 1),
          ],
          lines,
        );
        break;
      }
    }
  }
  return layers;
}

/** 服の形全体を囲む四角（写真を1枚の布として貼るのに使う） */
function bounds(paths: string[]): { x: number; y: number; w: number; h: number } {
  const n = paths
    .join(" ")
    .match(/-?\d+(\.\d+)?/g)!
    .map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** 写真のうち、服が写っていそうな真ん中の割合（写真のまわりの床や壁を貼らないように） */
const CROP = 0.72;
/** 生地を敷き詰めるときの1枚の大きさ（写真の幅の2割を切り出す） */
const SWATCH = 26;

function GarmentLayer({ layer, id, figureId }: { layer: Layer; id: string; figureId: string }) {
  const url = usePhotoUrl(layer.texture === "none" ? undefined : layer.garment.photo);
  const color = COLORS[layer.garment.color].hex;
  const pat = `${id}-p`;
  const box = bounds(layer.paths);
  const iw = box.w / CROP;
  const ih = box.h / CROP;
  return (
    <g filter={`url(#${figureId}-drop)`}>
      {url && (
        <defs>
          {layer.texture === "swatch" ? (
            <pattern id={pat} patternUnits="userSpaceOnUse" width={SWATCH} height={SWATCH}>
              <image
                href={url}
                x={-(0.3 * SWATCH) / 0.2 + SWATCH / 2}
                y={-(0.5 * SWATCH) / 0.2 + SWATCH / 2}
                width={SWATCH / 0.2}
                height={SWATCH / 0.2}
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          ) : (
            // 服の写真の真ん中を、袖も身ごろも続いた1枚の布として貼る
            <pattern id={pat} patternUnits="userSpaceOnUse" x={box.x} y={box.y} width={box.w} height={box.h}>
              <rect width={box.w} height={box.h} fill={color} />
              <image href={url} x={-(iw - box.w) / 2} y={-(ih - box.h) / 2} width={iw} height={ih} preserveAspectRatio="xMidYMid slice" />
            </pattern>
          )}
        </defs>
      )}
      {layer.paths.map((d, i) => (
        <g key={i}>
          <path d={d} fill={url ? `url(#${pat})` : color} />
          <path d={d} fill={`url(#${figureId}-shade)`} stroke="rgba(0,0,0,0.28)" strokeWidth="0.7" strokeLinejoin="round" />
        </g>
      ))}
      {layer.lines?.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="0.8" strokeLinecap="round" />
      ))}
    </g>
  );
}

export function OutfitFigure({ items, profile }: { items: Garment[]; profile: Profile }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const b = makeBody(profile);
  const { scale } = bodyShape(profile);
  // 頭のてっぺん（13.5）が、背の高さに合わせてどこに来るか
  const headTop = GROUND - (GROUND - 13.5) * scale;
  const skin = `url(#${id}-skin)`;
  return (
    <svg className="figure" viewBox="0 0 140 270" role="img" aria-label="着たときのイメージ">
      <defs>
        <radialGradient id={`${id}-bg`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="var(--figure-bg-1)" />
          <stop offset="1" stopColor="var(--figure-bg-2)" />
        </radialGradient>
        <linearGradient id={`${id}-skin`} x1="0" x2="1">
          <stop offset="0" stopColor="#f3ece3" />
          <stop offset="0.6" stopColor="#ddd2c4" />
          <stop offset="1" stopColor="#bfb2a2" />
        </linearGradient>
        {/* 左から光が当たった筒のような陰影（体の丸みが出る） */}
        <linearGradient id={`${id}-shade`} x1="0" x2="1" y1="0" y2="0.25">
          <stop offset="0" stopColor="#000" stopOpacity="0.12" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0.08" />
          <stop offset="1" stopColor="#000" stopOpacity="0.36" />
        </linearGradient>
        {/* 胸とおなかの丸み。体の幅に合わせて広がる */}
        <radialGradient id={`${id}-volume`} cx="0.4" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-drop`} x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0.8" dy="1.2" stdDeviation="1.2" floodOpacity="0.25" />
        </filter>
      </defs>
      <rect width="140" height="270" rx="12" fill={`url(#${id}-bg)`} />
      <ellipse cx={CX} cy="261" rx={(b.hp + 14) * scale} ry="5" fill="rgba(0,0,0,0.12)" />
      {profile.heightCm && (
        <g className="figure-height">
          <line x1="8" x2={CX - 16 * scale} y1={headTop} y2={headTop} stroke="var(--figure-mark)" strokeWidth="0.6" strokeDasharray="2 2" />
          <text x="8" y={headTop - 3} fontSize="8" fill="var(--figure-mark)">
            {profile.heightCm}cm
          </text>
        </g>
      )}

      <g transform={`translate(${CX} ${GROUND}) scale(${scale}) translate(${-CX} ${-GROUND})`}>
        {/* マネキン */}
        <g fill={skin} stroke="rgba(0,0,0,0.15)" strokeWidth="0.6">
          <path d={armPath(b, -1, 1, 0)} />
          <path d={armPath(b, 1, 1, 0)} />
          <path d={legsPath(b, { kind: "pants", width: "slim", length: "full" })} />
          <path d={torsoPath(b, 130, 0, 0)} />
          <rect x={CX - 5} y="40" width="10" height="14" rx="4" />
          <ellipse cx={CX} cy="28" rx="12" ry="14.5" />
          {shoePaths(b, "sneakers").map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {layersFor(items, b).map((l) => (
          <GarmentLayer key={l.garment.id} layer={l} figureId={id} id={`${id}-${l.garment.id.replace(/[^a-zA-Z0-9]/g, "")}`} />
        ))}
        <ellipse cx={CX - 3} cy="92" rx={b.wa + 8} ry="36" fill={`url(#${id}-volume)`} pointerEvents="none" />
      </g>
    </svg>
  );
}
