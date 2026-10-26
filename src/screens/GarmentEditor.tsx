// 服1着ぶんの入力欄。種類はタップで選ぶだけ、細かい項目は「詳しく」にしまっておく。
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { ColorDot, usePhotoUrl } from "../components/common";
import { ICON } from "../components/icons";
import { COLORS } from "../domain/colors";
import { PRESETS, applyPreset } from "../domain/presets";
import { CLOTHING_SIZES, SHOE_SIZES } from "../domain/profile";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FORMALITIES,
  FORMALITY_LABELS,
  SEASONS,
  SEASON_LABELS,
  type Category,
  type ColorName,
  type GarmentInfo,
  type Season,
  type Warmth,
} from "../domain/types";

export type Draft = Omit<GarmentInfo, "id">;

export const EMPTY_DRAFT: Draft = {
  category: "tops",
  subType: "",
  color: "black",
  seasons: ["spring", "autumn"],
  formality: "casual",
  warmth: 2,
};

const WARMTH_LABELS = ["薄手", "普通", "厚手"];

export function detailSummary(d: Draft): string {
  const seasons = d.seasons.length === 4 ? "通年" : d.seasons.map((s) => SEASON_LABELS[s]).join("・") || "季節なし";
  return `${seasons}／${FORMALITY_LABELS[d.formality]}／${WARMTH_LABELS[d.warmth - 1]}`;
}

export function GarmentEditor({
  photo,
  value,
  onChange,
  status,
}: {
  photo: Blob;
  value: Draft;
  onChange: (d: Draft) => void;
  /** 「判定中…」などの表示 */
  status?: { text: string; progress?: number; tone?: "info" | "warn" };
}) {
  const url = usePhotoUrl(photo);
  const [category, setCategory] = useState<Category>(value.category);
  const [custom, setCustom] = useState(false);
  // 一覧にない名前（AIが「ポロシャツ」と答えたなど）のときも、入力欄を出す
  const showCustom =
    custom || (value.subType !== "" && !PRESETS.some((p) => p.category === value.category && p.subType === value.subType));
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });

  // AIの判定などで種類が外から変わったら、表示中のカテゴリもそろえる
  const [prevCategory, setPrevCategory] = useState(value.category);
  if (value.category !== prevCategory) {
    setPrevCategory(value.category);
    setCategory(value.category);
  }

  const presets = PRESETS.filter((p) => p.category === category);
  const baseSizes: readonly string[] = value.category === "shoes" ? SHOE_SIZES : CLOTHING_SIZES;
  // 一覧にないサイズ（「W30」など）も選ばれた状態で見せる
  const sizeChoices = value.size && !baseSizes.includes(value.size) ? [value.size, ...baseSizes] : baseSizes;
  const toggleSeason = (s: Season) =>
    set({ seasons: value.seasons.includes(s) ? value.seasons.filter((x) => x !== s) : [...value.seasons, s] });

  return (
    <div className="editor">
      <div className="editor-photo">{url && <img src={url} alt="登録する服" />}</div>

      {status && (
        <div className={`status ${status.tone ?? "info"}`} role="status">
          {status.text}
          {status.progress !== undefined && <progress value={status.progress} max={1} />}
        </div>
      )}

      <section className="field-group" aria-label="種類">
        <div className="seg" role="tablist">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              className={category === c ? "on" : ""}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="chips big">
          {presets.map((p) => (
            <button
              key={p.subType}
              type="button"
              className={`chip${!showCustom && value.category === p.category && value.subType === p.subType ? " on" : ""}`}
              onClick={() => {
                setCustom(false);
                onChange(applyPreset(value, p));
              }}
            >
              {p.subType}
            </button>
          ))}
          <button
            type="button"
            className={`chip${showCustom ? " on" : ""}`}
            onClick={() => {
              setCustom(true);
              set({ category, subType: "" });
            }}
          >
            その他
          </button>
        </div>
        {showCustom && (
          <input
            id="custom-subtype"
            className="text"
            value={value.subType}
            placeholder="服の名前（例：ポロシャツ）"
            onChange={(e) => set({ category, subType: e.target.value })}
            maxLength={40}
            autoFocus
          />
        )}
      </section>

      <section className="field-group" aria-label="色">
        <div className="swatches">
          {(Object.keys(COLORS) as ColorName[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${value.color === c ? " on" : ""}`}
              onClick={() => set({ color: c })}
              aria-pressed={value.color === c}
            >
              <ColorDot color={c} />
              <span>{COLORS[c].label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="field-group size-row" aria-label="サイズ">
        <span className="size-row-label">サイズ</span>
        <div className="chips scroll">
          {sizeChoices.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${value.size === s ? " on" : ""}`}
              aria-pressed={value.size === s}
              onClick={() => set({ size: value.size === s ? undefined : s })}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <details className="more">
        <summary>
          <SlidersHorizontal {...ICON} />
          詳しく <span className="hint">{detailSummary(value)}</span>
        </summary>
        <div className="more-body">
          <div className="chips">
            {SEASONS.map((s) => (
              <button key={s} type="button" className={`chip${value.seasons.includes(s) ? " on" : ""}`} onClick={() => toggleSeason(s)}>
                {SEASON_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="chips">
            {FORMALITIES.map((f) => (
              <button key={f} type="button" className={`chip${value.formality === f ? " on" : ""}`} onClick={() => set({ formality: f })}>
                {FORMALITY_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="chips">
            {([1, 2, 3] as Warmth[]).map((w) => (
              <button key={w} type="button" className={`chip${value.warmth === w ? " on" : ""}`} onClick={() => set({ warmth: w })}>
                {WARMTH_LABELS[w - 1]}
              </button>
            ))}
          </div>
          <input
            id="garment-note"
            className="text"
            value={value.note ?? ""}
            placeholder="メモ（任意）"
            onChange={(e) => set({ note: e.target.value || undefined })}
            maxLength={200}
          />
        </div>
      </details>
    </div>
  );
}
