// 服の登録。写真を選ぶだけで、AIが種類と色を判定してそのまま登録する。
// 直したいときは、あとからタップして直す。種類が分からなかった写真だけ、1回タップで選んでもらう。
import { useEffect, useRef, useState } from "react";
import type { ClosetAI } from "../ai";
import { errorMessage, usePhotoUrl } from "../components/common";
import { applyPreset, PRESETS, presetFor, type Preset } from "../domain/presets";
import { CATEGORIES, CATEGORY_LABELS, type Garment, type GarmentAnalysis } from "../domain/types";
import { EMPTY_DRAFT, type Draft } from "./GarmentEditor";

interface Item {
  key: string;
  photo: Blob;
  state: "waiting" | "analyzing" | "saved" | "needsType" | "failed";
  progress?: { message: string; progress?: number };
  analysis?: GarmentAnalysis;
  elapsedMs?: number;
  /** 判定できた色など、種類を選んだときに使う */
  draft: Draft;
  garment?: Garment;
  error?: string;
}

function toItems(files: Iterable<File>): Item[] {
  return [...files].map((f) => ({ key: crypto.randomUUID(), photo: f, draft: EMPTY_DRAFT, state: "waiting" }));
}

/** 判定結果から登録内容を作る。種類が分からなければ undefined */
export function draftFromAnalysis(a: GarmentAnalysis): Draft | undefined {
  if (!a.category) return undefined;
  const base: Draft = { ...EMPTY_DRAFT, color: a.color };
  const preset = presetFor(a.subType, a.category);
  return preset ? applyPreset(base, preset) : { ...base, category: a.category, subType: a.subType || CATEGORY_LABELS[a.category] };
}

function toGarment(photo: Blob, d: Draft): Garment {
  return { ...d, subType: d.subType.trim() || CATEGORY_LABELS[d.category], id: crypto.randomUUID(), createdAt: Date.now(), photo };
}

export function AddGarments({
  ai,
  initialFiles,
  onSave,
  onEdit,
  onDone,
}: {
  ai: ClosetAI;
  /** クローゼット画面で先に選んだ写真 */
  initialFiles?: File[];
  onSave: (g: Garment, analysis?: { result: GarmentAnalysis; elapsedMs: number }) => Promise<void>;
  /** 登録した服を直す */
  onEdit: (g: Garment) => void;
  /** 登録した数を渡して閉じる */
  onDone: (saved: number) => void;
}) {
  const [items, setItems] = useState<Item[]>(() => toItems(initialFiles ?? []));
  const runningRef = useRef(false);
  const abortRef = useRef(new AbortController());

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    return () => ac.abort();
  }, []);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  async function save(it: Item, draft: Draft, analysis?: { result: GarmentAnalysis; elapsedMs: number }) {
    const garment = toGarment(it.photo, draft);
    await onSave(garment, analysis);
    update(it.key, { state: "saved", garment, draft });
  }

  // 1枚ずつ順番に判定して、種類が分かったらそのまま登録する（端末の負荷を抑えるため1枚ずつ）
  useEffect(() => {
    if (runningRef.current) return;
    const next = items.find((it) => it.state === "waiting");
    if (!next) return;
    runningRef.current = true;
    update(next.key, { state: "analyzing" });
    const started = performance.now();
    const { signal } = abortRef.current;
    ai.analyzeGarment(next.photo, { signal, onProgress: (p) => update(next.key, { progress: p }) })
      .then(async (a) => {
        const elapsedMs = performance.now() - started;
        const draft = draftFromAnalysis(a);
        if (draft) await save(next, draft, { result: a, elapsedMs });
        else update(next.key, { state: "needsType", analysis: a, elapsedMs, draft: { ...EMPTY_DRAFT, color: a.color } });
      })
      // 中断されたとき（開発時の再マウントなど）は、もう一度判定しなおす
      .catch((e) => update(next.key, signal.aborted ? { state: "waiting" } : { state: "failed", error: errorMessage(e) }))
      .finally(() => {
        runningRef.current = false;
        // 次の写真へ進めるため、もう一度この effect を走らせる
        setItems((cur) => [...cur]);
      });
  }, [items, ai]);

  const addPhotos = (files: FileList | null) => {
    if (files?.length) setItems((cur) => [...cur, ...toItems(files)]);
  };
  const remove = (key: string) => setItems((cur) => cur.filter((it) => it.key !== key));

  const saved = items.filter((it) => it.state === "saved").length;
  const busy = items.filter((it) => it.state === "waiting" || it.state === "analyzing").length;
  const needs = items.filter((it) => it.state === "needsType" || it.state === "failed");
  const current = items.find((it) => it.state === "analyzing");

  return (
    <section className="panel">
      <div className="row between">
        <h2>服を追加</h2>
        {items.length > 0 && (
          <button className="btn primary" onClick={() => onDone(saved)}>
            {busy ? "ここでやめる" : "完了"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <>
          <PhotoPickers onPick={addPhotos} />
          <p className="hint">写真を選ぶだけで、種類と色を判定して登録します。無地の壁や床の上に1着ずつ置いて撮ると当たりやすくなります。</p>
          <div className="actions">
            <button className="btn ghost" onClick={() => onDone(0)}>
              もどる
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="status info" role="status">
            {busy > 0
              ? `判定して登録しています…（残り${busy}枚）${current?.progress ? `　${current.progress.message}` : ""}`
              : `${saved > 0 ? `${saved}着を登録しました。` : ""}${needs.length ? `あと${needs.length}枚、種類を選んでください。` : ""}`}
            {current?.progress?.progress !== undefined && <progress value={current.progress.progress} max={1} />}
            {busy > 0 && <small>終わるまでこの画面のままにしてください。</small>}
          </div>

          {needs.map((it) => (
            <ChooseType
              key={it.key}
              item={it}
              onChoose={(p) =>
                save(
                  it,
                  applyPreset(it.draft, p),
                  it.analysis && it.elapsedMs !== undefined ? { result: it.analysis, elapsedMs: it.elapsedMs } : undefined,
                ).catch((e) => update(it.key, { state: "failed", error: errorMessage(e) }))
              }
              onRemove={() => remove(it.key)}
            />
          ))}

          <div className="grid">
            {items
              .filter((it) => it.state !== "needsType" && it.state !== "failed")
              .map((it) => (
                // 判定中に画面を移ると残りが止まるので、直すのは全部終わってから
                <AddedThumb key={it.key} item={it} onClick={it.garment && !busy ? () => onEdit(it.garment!) : undefined} />
              ))}
          </div>
          {saved > 0 && !busy && <p className="hint">違っていたら、タップして直せます。</p>}

          <PhotoPickers onPick={addPhotos} compact />
        </>
      )}
    </section>
  );
}

function AddedThumb({ item, onClick }: { item: Item; onClick?: () => void }) {
  const url = usePhotoUrl(item.photo);
  const Tag = onClick ? "button" : "div";
  const label = item.garment ? item.garment.subType : item.state === "analyzing" ? "判定中…" : "待っています";
  return (
    <Tag type={onClick ? "button" : undefined} className={`thumb${item.garment ? "" : " pending"}`} onClick={onClick}>
      {url && <img src={url} alt={label} />}
      <span className="thumb-label">{label}</span>
    </Tag>
  );
}

/** 種類が分からなかった写真だけ、よくある種類から1回タップで選んでもらう（色は判定済み） */
function ChooseType({ item, onChoose, onRemove }: { item: Item; onChoose: (p: Preset) => void; onRemove: () => void }) {
  const url = usePhotoUrl(item.photo);
  return (
    <div className="choose">
      <div className="row">
        {url && <img className="choose-photo" src={url} alt="種類が分からなかった服" />}
        <div className="grow">
          <p>{item.state === "failed" ? "うまく判定できませんでした。" : "種類だけ分かりませんでした。"}どれですか？</p>
          <button className="link" onClick={onRemove}>
            この写真はやめる
          </button>
        </div>
      </div>
      {CATEGORIES.map((c) => (
        <div key={c} className="chips">
          {PRESETS.filter((p) => p.category === c).map((p) => (
            <button key={p.subType} type="button" className="chip" onClick={() => onChoose(p)}>
              {p.subType}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 「撮る」と「アルバムから選ぶ」を分ける（capture を付けるとiPhoneでアルバムを選べないため） */
export function PhotoPickers({ onPick, compact }: { onPick: (files: FileList | null) => void; compact?: boolean }) {
  return (
    <div className={compact ? "pickers compact" : "pickers"}>
      <label className="picker">
        <span className="picker-icon" aria-hidden>
          📷
        </span>
        {compact ? "続けて撮る" : "カメラで撮る"}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onPick(e.target.files), (e.target.value = ""))} />
      </label>
      <label className="picker">
        <span className="picker-icon" aria-hidden>
          🖼
        </span>
        {compact ? "アルバムから追加" : "アルバムから選ぶ"}
        {!compact && <small>何枚でもまとめてOK</small>}
        <input type="file" accept="image/*" multiple hidden onChange={(e) => (onPick(e.target.files), (e.target.value = ""))} />
      </label>
    </div>
  );
}
