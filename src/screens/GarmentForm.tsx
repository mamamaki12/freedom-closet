// 服の登録・編集。写真を選ぶとAIが種類と色を入れ、本人が直してから保存する。
import { useRef, useState } from "react";
import type { ClosetAI } from "../ai";
import { ColorDot, errorMessage, usePhotoUrl } from "../components/common";
import { COLORS } from "../domain/colors";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FORMALITIES,
  FORMALITY_LABELS,
  SEASONS,
  SEASON_LABELS,
  type Category,
  type ColorName,
  type Formality,
  type Garment,
  type GarmentAnalysis,
  type Season,
  type Warmth,
} from "../domain/types";

const DEFAULT_SUBTYPE: Record<Category, string> = {
  tops: "Tシャツ",
  outer: "ジャケット",
  bottoms: "パンツ",
  onepiece: "ワンピース",
  shoes: "スニーカー",
};

export function GarmentForm({
  ai,
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  ai: ClosetAI;
  initial?: Garment;
  onSave: (g: Garment) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [photo, setPhoto] = useState<Blob | undefined>(initial?.photo);
  const [category, setCategory] = useState<Category>(initial?.category ?? "tops");
  const [subType, setSubType] = useState(initial?.subType ?? "");
  const [color, setColor] = useState<ColorName>(initial?.color ?? "black");
  const [seasons, setSeasons] = useState<Season[]>(initial?.seasons ?? ["spring", "autumn"]);
  const [formality, setFormality] = useState<Formality>(initial?.formality ?? "casual");
  const [warmth, setWarmth] = useState<Warmth>(initial?.warmth ?? 2);
  const [note, setNote] = useState(initial?.note ?? "");
  const [analysis, setAnalysis] = useState<GarmentAnalysis>();
  const [status, setStatus] = useState<{ message: string; progress?: number }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const photoUrl = usePhotoUrl(photo);

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setPhoto(file);
    setError(undefined);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ message: "判定の準備中…" });
    try {
      const a = await ai.analyzeGarment(file, { signal: ac.signal, onProgress: setStatus });
      if (ac.signal.aborted) return;
      setAnalysis(a);
      if (a.category) setCategory(a.category);
      if (a.subType) setSubType(a.subType);
      setColor(a.color);
    } catch (e) {
      if (!ac.signal.aborted) setError(`自動判定できませんでした。手で選んでください。（${errorMessage(e)}）`);
    } finally {
      if (abortRef.current === ac) setStatus(undefined);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) return setError("写真を選んでください");
    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? crypto.randomUUID(),
        createdAt: initial?.createdAt ?? Date.now(),
        photo,
        category,
        subType: subType.trim() || DEFAULT_SUBTYPE[category],
        color,
        seasons,
        formality,
        warmth,
        note: note.trim() || undefined,
      });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  const toggleSeason = (s: Season) =>
    setSeasons((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>{initial ? "服を編集" : "服を追加"}</h2>

      <label className="photo-picker">
        {photoUrl ? <img src={photoUrl} alt="選んだ服" /> : <span>タップして撮影・写真を選ぶ</span>}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => onPickPhoto(e.target.files?.[0])}
        />
      </label>
      <p className="hint">無地の壁や床の上に、1着だけ広げて撮ると判定しやすくなります。</p>

      {status && (
        <div className="status" role="status">
          {status.message}
          {status.progress !== undefined && <progress value={status.progress} max={1} />}
        </div>
      )}
      {analysis && !status && (
        <p className="hint">
          {analysis.category
            ? `${ai.label}の判定：${CATEGORY_LABELS[analysis.category]}・${analysis.subType}・${COLORS[analysis.color].label}`
            : `${ai.label}の判定：色は${COLORS[analysis.color].label}`}
          {analysis.category && analysis.confidence < 0.5 && "（自信が低いので確認してください）"}
        </p>
      )}
      {analysis?.warning && !status && <p className="error">{analysis.warning}</p>}
      {error && <p className="error">{error}</p>}

      <fieldset>
        <legend>種類</legend>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={`chip${category === c ? " on" : ""}`} onClick={() => setCategory(c)}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <input
          className="text"
          value={subType}
          placeholder={`例：${DEFAULT_SUBTYPE[category]}`}
          onChange={(e) => setSubType(e.target.value)}
          maxLength={40}
          aria-label="服の名前"
        />
        {analysis && analysis.candidates.length > 1 && (
          <div className="chips small">
            {analysis.candidates.map((c) => (
              <button
                key={c.subType}
                type="button"
                className="chip"
                onClick={() => {
                  setCategory(c.category);
                  setSubType(c.subType);
                }}
              >
                {c.subType}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>色</legend>
        <div className="chips">
          {(Object.keys(COLORS) as ColorName[]).map((c) => (
            <button key={c} type="button" className={`chip${color === c ? " on" : ""}`} onClick={() => setColor(c)}>
              <ColorDot color={c} />
              {COLORS[c].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>着る季節</legend>
        <div className="chips">
          {SEASONS.map((s) => (
            <button key={s} type="button" className={`chip${seasons.includes(s) ? " on" : ""}`} onClick={() => toggleSeason(s)}>
              {SEASON_LABELS[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>雰囲気・厚さ</legend>
        <div className="chips">
          {FORMALITIES.map((f) => (
            <button key={f} type="button" className={`chip${formality === f ? " on" : ""}`} onClick={() => setFormality(f)}>
              {FORMALITY_LABELS[f]}
            </button>
          ))}
        </div>
        <div className="chips">
          {([1, 2, 3] as Warmth[]).map((w) => (
            <button key={w} type="button" className={`chip${warmth === w ? " on" : ""}`} onClick={() => setWarmth(w)}>
              {["薄手", "普通", "厚手"][w - 1]}
            </button>
          ))}
        </div>
      </fieldset>

      <input className="text" value={note} placeholder="メモ（任意）" onChange={(e) => setNote(e.target.value)} maxLength={200} />

      <div className="actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          やめる
        </button>
        {onDelete && (
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              // 間違えて消さないよう、2回押したら削除
              if (!confirmDelete) return setConfirmDelete(true);
              setSaving(true);
              await onDelete();
            }}
            disabled={saving}
          >
            {confirmDelete ? "もう一度押すと削除" : "削除"}
          </button>
        )}
        <button type="submit" className="btn primary" disabled={saving || !photo}>
          保存
        </button>
      </div>
    </form>
  );
}
