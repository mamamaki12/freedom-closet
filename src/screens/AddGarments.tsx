// 服の登録。写真を選ぶだけで、AIが種類と色を判定してそのまま登録する。
// 直したいときは、あとからタップして直す。種類が分からなかった写真だけ、1回タップで選んでもらう。
import { ArrowLeft, Ban, Camera, Check, Images, Info, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ClosetAI } from "../ai";
import { errorMessage, usePhotoUrl } from "../components/common";
import { shortLabel } from "../domain/colors";
import { BtnText, ICON } from "../components/icons";
import { applyPreset, PRESETS, presetFor, type Preset } from "../domain/presets";
import { sizeGroup, type Profile } from "../domain/profile";
import { CATEGORIES, CATEGORY_LABELS, REVIEW_THRESHOLD, type Garment, type GarmentAnalysis } from "../domain/types";
import { shrinkPhoto } from "../storage/photo";
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
  const base: Draft = { ...EMPTY_DRAFT, ...colorsFromAnalysis(a) };
  const preset = presetFor(a.subType, a.category);
  return preset ? applyPreset(base, preset) : { ...base, category: a.category, subType: a.subType || CATEGORY_LABELS[a.category] };
}

/** 判定結果のうち、色と柄だけ（種類が分からなかったときにも使う） */
function colorsFromAnalysis(a: GarmentAnalysis): Pick<Draft, "color" | "pattern" | "subColor"> {
  return { color: a.color, pattern: a.pattern ?? "solid", ...(a.subColor ? { subColor: a.subColor } : {}) };
}

/**
 * 登録する服を作る。自動判定のまま登録するときは確からしさも残し、
 * 低ければ「確認したい服」の目印を付ける（本人が種類を選んだときは付けない）。
 */
export function toGarment(photo: Blob, d: Draft, profile: Profile, auto?: { confidence: number }): Garment {
  // サイズは写真から分からないので、いつものサイズを入れておく（違えばあとで直す）
  const size = d.size ?? profile.usualSize?.[sizeGroup(d.category)];
  return {
    ...d,
    ...(size ? { size } : {}),
    subType: d.subType.trim() || CATEGORY_LABELS[d.category],
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    photo,
    ...(auto ? { aiConfidence: auto.confidence, ...(auto.confidence < REVIEW_THRESHOLD ? { needsReview: true } : {}) } : {}),
  };
}

export function AddGarments({
  ai,
  profile,
  initialFiles,
  onSave,
  onEdit,
  onDone,
}: {
  ai: ClosetAI;
  profile: Profile;
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

  // 写真を選んでいる間に、判定モデルの読み込み（初回はダウンロード）を進めておく
  useEffect(() => ai.prepare?.(), [ai]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  async function save(
    it: Item,
    draft: Draft,
    analysis?: { result: GarmentAnalysis; elapsedMs: number },
    photo = it.photo,
    /** 自動判定のまま登録するとき true（本人が種類を選んだときは false） */
    auto = false,
  ) {
    const made = toGarment(photo, draft, profile, auto && analysis ? { confidence: analysis.result.confidence } : undefined);
    // 判定できなかった（色も分からなかった）服は、あとで見直せるよう「確認」の目印を付ける
    const garment: Garment = analysis ? made : { ...made, needsReview: true };
    await onSave(garment, analysis);
    update(it.key, { state: "saved", garment, draft, photo });
  }

  // 1枚ずつ順番に判定して、種類が分かったらそのまま登録する（端末の負荷を抑えるため1枚ずつ）
  useEffect(() => {
    if (runningRef.current) return;
    const next = items.find((it) => it.state === "waiting");
    if (!next) return;
    runningRef.current = true;
    update(next.key, { state: "analyzing" });
    const { signal } = abortRef.current;
    let shrunk = next.photo;
    let analyzed: Pick<Item, "analysis" | "elapsedMs" | "draft"> | undefined;
    // 先に写真を縮めておく（保存する容量を減らし、判定も速くなる）
    shrinkPhoto(next.photo)
      .then(async (photo) => {
        shrunk = photo;
        const started = performance.now();
        const a = await ai.analyzeGarment(photo, { signal, onProgress: (p) => update(next.key, { progress: p }) });
        const elapsedMs = performance.now() - started;
        analyzed = { analysis: a, elapsedMs, draft: { ...EMPTY_DRAFT, ...colorsFromAnalysis(a) } };
        const draft = draftFromAnalysis(a);
        if (draft) await save(next, draft, { result: a, elapsedMs }, photo, true);
        else update(next.key, { state: "needsType", analysis: a, elapsedMs, photo, draft: { ...EMPTY_DRAFT, ...colorsFromAnalysis(a) } });
      })
      // 中断されたとき（開発時の再マウントなど）は、もう一度判定しなおす
      // 失敗しても、縮めた写真と（判定はできて保存だけ失敗したときは）判定した色は残す
      .catch((e) =>
        update(next.key, signal.aborted ? { state: "waiting" } : { state: "failed", error: errorMessage(e), photo: shrunk, ...analyzed }),
      )
      .finally(() => {
        runningRef.current = false;
        // 次の写真へ進めるため、もう一度この effect を走らせる
        setItems((cur) => [...cur]);
      });
  }, [items, ai]);

  const addPhotos = (files: File[]) => {
    const added = toItems(files);
    setItems((cur) => [...cur, ...added]);
  };
  const remove = (key: string) => setItems((cur) => cur.filter((it) => it.key !== key));
  // 通信が戻ったときなどに、もう一度判定する
  const retry = (key: string) => update(key, { state: "waiting", error: undefined, analysis: undefined, progress: undefined });

  const saved = items.filter((it) => it.state === "saved").length;
  const unsure = items.filter((it) => it.garment?.needsReview).length;
  const busy = items.filter((it) => it.state === "waiting" || it.state === "analyzing").length;
  const needs = items.filter((it) => it.state === "needsType" || it.state === "failed");
  const current = items.find((it) => it.state === "analyzing");

  return (
    <section className="panel">
      {/* 写真を選ぶ前の「もどる」は、服の詳細と同じく見出しの左に置く（下の右にぽつんと離れていた） */}
      <div className="row between add-head">
        <div className="row add-title">
          {items.length === 0 && (
            <button className="btn ghost icon-only" onClick={() => onDone(0)} aria-label="もどる" title="もどる">
              <ArrowLeft size={22} aria-hidden />
            </button>
          )}
          <h2>服を追加</h2>
        </div>
        {items.length > 0 && (
          <button className={busy ? "btn" : "btn primary"} onClick={() => onDone(saved)} title={busy ? "ここでやめる" : "完了"}>
            {busy ? <X {...ICON} /> : <Check {...ICON} />}
            {busy ? <BtnText text="ここでやめる" short="やめる" /> : <BtnText text="完了" />}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <>
          <PhotoPickers onPick={addPhotos} />
          <p className="hint">写真を選ぶだけで、種類と色を判定して登録します。無地の壁や床の上に1着ずつ置いて撮ると当たりやすくなります。</p>
          {ai.setupNote?.() && <p className="hint">{ai.setupNote()}</p>}
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

          {/* 種類が分からなかった写真は1枚ずつ聞く（全部並べると画面が長くなるため） */}
          {needs.slice(0, 1).map((it) => (
            <ChooseType
              key={it.key}
              item={it}
              rest={needs.length - 1}
              onChoose={(p) =>
                save(
                  it,
                  applyPreset(it.draft, p),
                  it.analysis && it.elapsedMs !== undefined ? { result: it.analysis, elapsedMs: it.elapsedMs } : undefined,
                ).catch((e) => update(it.key, { state: "failed", error: errorMessage(e) }))
              }
              onRemove={() => remove(it.key)}
              onRetry={() => retry(it.key)}
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
          {saved > 0 && !busy && (
            <p className="hint">
              違っていたら、タップして直せます。
              {unsure > 0 && `「確認」の付いた${unsure}着は自信がないので、あとでクローゼットからも見られます。`}
            </p>
          )}

          <PhotoPickers onPick={addPhotos} compact />
        </>
      )}
    </section>
  );
}

function AddedThumb({ item, onClick }: { item: Item; onClick?: () => void }) {
  const url = usePhotoUrl(item.photo);
  const Tag = onClick ? "button" : "div";
  const label = item.garment ? shortLabel(item.garment) : item.state === "analyzing" ? "判定中…" : "待っています";
  return (
    <Tag type={onClick ? "button" : undefined} className={`thumb${item.garment ? "" : " pending"}`} onClick={onClick}>
      {url && <img src={url} alt={label} />}
      {item.garment?.needsReview && <span className="thumb-badge">確認</span>}
      <span className="thumb-label">{label}</span>
    </Tag>
  );
}

/** 種類が分からなかった写真だけ、よくある種類から1回タップで選んでもらう（色は判定済み） */
function ChooseType({
  item,
  rest,
  onChoose,
  onRemove,
  onRetry,
}: {
  item: Item;
  /** このあとに残っている枚数 */
  rest: number;
  onChoose: (p: Preset) => void;
  onRemove: () => void;
  /** もう一度判定する（ほかの写真を判定中なら、その次に回す） */
  onRetry: () => void;
}) {
  const url = usePhotoUrl(item.photo);
  const failed = item.state === "failed";
  // 判定できなかったとき・モデルを読み込めなかったときは、もう一度試すと直ることがある（服ではないと判定されたときは同じ答えになる）
  const canRetry = failed || (item.analysis?.candidates.length === 0 && !!item.analysis.warning);
  // 理由（モデルを読み込めなかった など）は長くなるので、短い1行だけ見せて、くわしくは開いて読む
  const why = failed ? item.error && `理由：${item.error}` : item.analysis?.warning;
  return (
    <div className="choose">
      <div className="row choose-head">
        {url && <img className="choose-photo" src={url} alt="種類が分からなかった服" />}
        <div className="grow">
          <p className="choose-title">
            {failed ? (item.analysis ? "保存できませんでした。" : "判定できませんでした。") : "種類が分かりませんでした。"}
            どれですか？
          </p>
          {rest > 0 && <p className="hint">このあと{rest}枚</p>}
          {failed && !item.analysis && <p className="hint">色はあとで直してください。</p>}
        </div>
      </div>
      <div className="choose-actions">
        {canRetry && (
          <button className="btn ghost small" onClick={onRetry} title="もう一度判定する">
            <RotateCcw {...ICON} />
            <BtnText text="もう一度判定する" short="再判定" />
          </button>
        )}
        <button className="btn ghost small" onClick={onRemove} title="服ではない・やめる">
          <Ban {...ICON} />
          <BtnText text="服ではない・やめる" short="やめる" />
        </button>
        {why && (
          <details className="more choose-why">
            <summary>
              <Info {...ICON} />
              くわしく
            </summary>
            <p className="hint">{why}</p>
          </details>
        )}
      </div>
      {/* 種類はカテゴリーごとに小さな見出しを付け、チップは折り返して並べる */}
      <div className="choose-groups">
        {CATEGORIES.map((c) => (
          <div key={c} className="choose-group" role="group" aria-labelledby={`choose-${item.key}-${c}`}>
            <h3 id={`choose-${item.key}-${c}`} className="choose-heading">
              {CATEGORY_LABELS[c]}
            </h3>
            <div className="chips">
              {PRESETS.filter((p) => p.category === c).map((p) => (
                <button key={p.subType} type="button" className="chip" onClick={() => onChoose(p)}>
                  {p.subType}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 「撮る」と「アルバムから選ぶ」を分ける（capture を付けるとiPhoneでアルバムを選べないため）。
 * 最初は「カメラで撮る」を大きく、アルバムはその下に細く出す。登録画面の下では2つ並べて小さく出す。
 */
export function PhotoPickers({ onPick, compact }: { onPick: (files: File[]) => void; compact?: boolean }) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    // FileList は input の value を消すと空になるので、先に配列に写してから消す
    // （setState の更新関数の中で読むと、もう空になっていて写真が足されないことがあった）
    const files = e.target.files ? [...e.target.files] : [];
    e.target.value = "";
    if (files.length) onPick(files);
  };
  return (
    <div className={compact ? "pickers compact" : "pickers stacked"}>
      <label className="picker camera" title={compact ? "続けて撮る" : "カメラで撮る"}>
        <Camera className="picker-icon" size={compact ? 20 : 48} strokeWidth={1.6} aria-hidden />
        <BtnText text={compact ? "続けて撮る" : "カメラで撮る"} short="撮る" />
        <input type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </label>
      <label className="picker album" title={compact ? "アルバムから追加" : "アルバムから選ぶ"}>
        <Images className="picker-icon" size={20} strokeWidth={1.8} aria-hidden />
        <BtnText text={compact ? "アルバムから追加" : "アルバムから選ぶ"} short="アルバム" />
        {!compact && <small>まとめて選べます</small>}
        <input type="file" accept="image/*" multiple hidden onChange={pick} />
      </label>
    </div>
  );
}
