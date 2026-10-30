// 3Dのマネキンに服を着せた「着たときのイメージ」。一覧では画像にして軽くし、タップで指で回して見られる。
import { Rotate3d, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OutfitFigure } from "../components/OutfitFigure";
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import type { Garment } from "../domain/types";
import { defaultScan } from "./measure";
import type { BodyScan } from "./types";

/** three.js は大きいので、使うときに読み込む */
const load = () => import("./render3d");

let webgl: boolean | undefined;
function canUse3D(): boolean {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

function useScene(scan: BodyScan, items: Garment[], scale: number) {
  return () => load().then((r) => r.buildScene(scan, items, scale));
}

/** 指で回して見る画面 */
export function Viewer3D({ scan, items, scale, onClose, title }: { scan: BodyScan; items: Garment[]; scale: number; onClose?: () => void; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const build = useScene(scan, items, scale);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    Promise.all([load(), build()])
      .then(([r, scene]) => {
        if (alive && ref.current) stop = r.mountViewer(ref.current, scene);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
      stop?.();
    };
  }, [scan, items, scale]);
  const canvas = <canvas ref={ref} className="viewer3d-canvas" aria-label="3Dモデル。指でなぞると回せます" />;
  if (!onClose) return error ? <p className="hint">3Dを表示できませんでした。</p> : canvas;
  return (
    <div className="viewer3d" role="dialog" aria-modal="true" aria-label={title ?? "着たときのイメージ"}>
      <div className="viewer3d-bar">
        <span>{title ?? "着たときのイメージ"}</span>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="閉じる" title="閉じる">
          <X size={22} aria-hidden />
        </button>
      </div>
      {error ? <p className="hint">3Dを表示できませんでした。</p> : canvas}
      <p className="viewer3d-hint">
        <Rotate3d size={16} aria-hidden />
        指でなぞると回せます
      </p>
    </div>
  );
}

/** コーデのカードに出す画像。3Dが使えない端末では平面のイラストにする */
export function Figure3D({ items, profile, scan }: { items: Garment[]; profile: Profile; scan?: BodyScan }) {
  const profileJson = JSON.stringify(profile);
  // 体型が変わったときだけ作り直す（毎回新しく作ると、回す画面が作り直されてしまう）
  const body = useMemo(() => scan ?? defaultScan(JSON.parse(profileJson)), [scan, profileJson]);
  const scale = bodyShape(profile).scale;
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // 服の種類・色・体型が変わったときだけ描き直す
  const key = items.map((g) => `${g.id}:${g.subType}:${g.color}`).join("|") + profileJson + (scan?.at ?? "");
  const stable = useMemo(() => items, [key]);
  const build = useScene(body, stable, scale);

  useEffect(() => {
    if (!canUse3D()) return setFailed(true);
    let alive = true;
    let made: string | undefined;
    Promise.all([load(), build()])
      .then(([r, scene]) => r.snapshot(scene, 300, 560))
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);

  if (failed) return <OutfitFigure items={items} profile={profile} />;
  return (
    <>
      <button type="button" className="figure3d" onClick={() => setOpen(true)} aria-label="着たときのイメージを回して見る">
        {url ? <img src={url} alt="着たときのイメージ" /> : <span className="figure3d-loading">3Dを準備中…</span>}
        <span className="figure3d-badge">
          <Rotate3d size={14} aria-hidden />
          3D
        </span>
      </button>
      {/* 一覧のレイアウトの影響を受けないよう、画面のいちばん外側に出す */}
      {open && createPortal(<Viewer3D scan={body} items={stable} scale={scale} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
