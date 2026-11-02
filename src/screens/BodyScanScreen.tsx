// 体の写真（正面・横）から3Dの体型モデルを作る。写真は端末の中で読み取るだけで、保存も送信もしない。
import { ArrowLeft, Check, Lock, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Viewer3D } from "../body/Figure3D";
import { buildScan, fitClothes, type FrontMeasure } from "../body/measure";
import type { BodyScan } from "../body/types";
import { errorMessage } from "../components/common";
import { ICON } from "../components/icons";
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";
import { PhotoPickers } from "./AddGarments";

type Step = "front" | "side" | "done";

const GUIDE: Record<Exclude<Step, "done">, { title: string; tips: string[] }> = {
  front: {
    title: "1枚め：正面",
    tips: ["頭から足先までが画面に入るように", "まっすぐ立って、両腕を体から少し離し、足は肩幅くらいに", "下着か、体にぴったりした服で。ゆったりした服だと、太さは身長・体重からの見積もりになります", "誰かに撮ってもらうか、タイマーで。スマホは腰の高さに"],
  },
  side: {
    title: "2枚め：横向き",
    tips: ["右か左を向いて、まっすぐ立つ", "腕は体の横に下ろす", "1枚めと同じ場所・同じ距離で"],
  },
};

export function BodyScanScreen({ profile, onSave, onClose }: { profile: Profile; onSave: (scan: BodyScan) => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>("front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [front, setFront] = useState<FrontMeasure>();
  const [scan, setScan] = useState<BodyScan>();
  const [loose, setLoose] = useState(false);
  const scale = useMemo(() => bodyShape(profile).scale, [profile]);

  // 写真を撮っている間に、読み取りの部品とモデル（約9MB）のダウンロードを進めておく
  useEffect(() => {
    import("../body/scan")
      .then((m) => m.prepareBodyScan())
      .catch(() => undefined);
  }, []);

  // 服を着て撮った分をさし引く（ゆったりした服なら、そう知らせる）
  function finish(raw: BodyScan) {
    const r = fitClothes(raw, profile);
    setScan(r.scan);
    setLoose(r.loose);
    setStep("done");
  }

  async function read(files: FileList | null) {
    const photo = files?.[0];
    if (!photo) return;
    setBusy(true);
    setError(undefined);
    try {
      const { scanFront, scanSide } = await import("../body/scan");
      if (step === "front") {
        const f = await scanFront(photo);
        setFront(f);
        setStep("side");
      } else if (front) {
        finish(buildScan(front, await scanSide(photo, front)));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function skipSide() {
    if (!front) return;
    finish(buildScan(front));
  }

  function restart() {
    setFront(undefined);
    setScan(undefined);
    setLoose(false);
    setError(undefined);
    setStep("front");
  }

  return (
    <section className="panel">
      <div className="row between">
        <button className="btn ghost icon-only" onClick={onClose} disabled={busy} aria-label="もどる" title="もどる">
          <ArrowLeft size={22} aria-hidden />
        </button>
      </div>
      <h2>体の写真で3Dモデルを作る</h2>
      <p className="hint privacy">
        <Lock size={14} aria-hidden />
        写真はこのスマホの中で体の形を読み取るだけで、保存も送信もしません。残るのは肩幅や脚の長さなどの数字だけです。下着か、体にぴったりした服で撮ると正確になります。
      </p>

      {step !== "done" && (
        <>
          <ol className="scan-steps">
            <li className={step === "front" ? "on" : "done"}>正面</li>
            <li className={step === "side" ? "on" : ""}>横向き</li>
          </ol>
          <h3>{GUIDE[step].title}</h3>
          <ul className="tips">
            {GUIDE[step].tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {busy ? (
            <p className="hint">読み取り中…（初めてのときは、読み取りの準備に少し時間がかかります）</p>
          ) : (
            <PhotoPickers onPick={read} />
          )}
          {error && <p className="error">{error}</p>}
          {step === "side" && !busy && (
            <button className="btn ghost wide" onClick={skipSide}>
              <SkipForward {...ICON} />
              横向きはとばす（厚みは見積もりにする）
            </button>
          )}
        </>
      )}

      {step === "done" && scan && (
        <>
          <div className="scan-result">
            <Viewer3D scan={scan} items={[]} scale={scale} />
          </div>
          <p className="hint">
            {scan.views.includes("side") ? "正面と横向きの写真から作りました。" : "正面の写真から作りました（体の厚みは見積もりです）。"}
            {front?.armsTouching && "腕が体についていたので、胴の幅は少し不正確かもしれません。"}
            {loose && "ゆったりした服のようなので、胴や脚の太さは身長・体重からの見積もりに寄せました。下着か、体にぴったりした服で撮ると正確になります。"}
          </p>
          <div className="sticky-actions">
            <button className="btn" onClick={restart}>
              <RotateCcw {...ICON} />
              撮り直す
            </button>
            <button className="btn primary grow" onClick={() => onSave(scan)}>
              <Check {...ICON} />
              この体型を使う
            </button>
          </div>
        </>
      )}
    </section>
  );
}
