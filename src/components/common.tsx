import { HelpCircle } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { COLORS, shortLabel } from "../domain/colors";
import { garmentNameParts, isLongName } from "../domain/names";
import type { ColorName, Garment } from "../domain/types";

export function usePhotoUrl(photo: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!photo) return setUrl(undefined);
    const u = URL.createObjectURL(photo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url;
}

/**
 * 横にずらせる列の、左右にまだ続きがあるか。続きがある側の端を薄くして「まだある」と分かるようにする。
 * 1つ目は列の要素に渡す ref（あとから画面に出る列でも動くよう、callback ref にしている）、
 * 2つ目は className にそのまま足す文字（" more-left more-right" など）
 */
export function useScrollEdges(): [(el: HTMLElement | null) => void, string] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState("");
  useEffect(() => {
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges(`${left ? " more-left" : ""}${right ? " more-right" : ""}`);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [el]);
  return [setEl, edges];
}

export function GarmentThumb({
  garment,
  selected,
  onClick,
  size = "md",
  caption,
  isNew,
}: {
  garment: Garment;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
  /** 名前の下に小さく出す補足（「3日前」など） */
  caption?: ReactNode;
  /** いま登録したばかりの服に「新しい」の印を付ける */
  isNew?: boolean;
}) {
  const url = usePhotoUrl(garment.photo);
  const Tag = onClick ? "button" : "div";
  const label = shortLabel(garment);
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`thumb thumb-${size}${selected ? " selected" : ""}`}
      onClick={onClick}
      aria-pressed={onClick ? !!selected : undefined}
    >
      {url && <img src={url} alt={label} />}
      {garment.needsReview && size === "md" && (
        <span className="thumb-badge" title="自動判定に自信がない服">
          <HelpCircle size={14} strokeWidth={2.4} aria-hidden />
          確認
        </span>
      )}
      {isNew && size === "md" && <span className="thumb-badge new">新しい</span>}
      <span className="thumb-label">
        <ColorDot color={garment.color} />
        {garment.subColor && garment.subColor !== garment.color && <ColorDot color={garment.subColor} />}
        <NameText parts={garmentNameParts(garment)} />
      </span>
      {caption && <span className="thumb-caption">{caption}</span>}
    </Tag>
  );
}

/**
 * 服の名前。「デニムジャケット」「ボーダーTシャツ」のように分けられる名前は、言葉の切れ目（デニム／ジャケット）で2行まで折り返す。
 * 1つの切れ目の中が6文字以上（カーディガン など）のときは、少し小さい文字にして切れにくくする。入らなければ「…」
 */
export function NameText({ parts }: { parts: string[] }) {
  const cls = `thumb-name${parts.length > 1 ? " split" : ""}${isLongName(parts) ? " long" : ""}`;
  return (
    <span className={cls}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {p}
        </Fragment>
      ))}
    </span>
  );
}

/** 小さな写真と名前だけの1行（押せない）。たくさん並べても場所を取らない */
export function GarmentChip({ garment }: { garment: Garment }) {
  const url = usePhotoUrl(garment.photo);
  const label = shortLabel(garment);
  return (
    <li className="garment-chip">
      {url ? <img src={url} alt="" /> : <span className="garment-chip-img" style={{ background: COLORS[garment.color].hex }} aria-hidden />}
      {label}
    </li>
  );
}

/** 服の小さな写真だけ（飾り。読み上げない）。たたんだ行で「どの服か」をひと目で見せる */
export function GarmentFace({ garment }: { garment: Garment }) {
  const url = usePhotoUrl(garment.photo);
  return url ? (
    <img className="garment-face" src={url} alt="" />
  ) : (
    <span className="garment-face" style={{ background: COLORS[garment.color].hex }} aria-hidden />
  );
}

export function ColorDot({ color }: { color: ColorName }) {
  return <span className="color-dot" style={{ background: COLORS[color].hex }} aria-hidden />;
}

export function ColorChips({
  value,
  onToggle,
  small,
}: {
  value: ColorName[];
  onToggle: (c: ColorName) => void;
  small?: boolean;
}) {
  return (
    <div className={small ? "chips small" : "chips"}>
      {(Object.keys(COLORS) as ColorName[]).map((c) => (
        <button
          key={c}
          type="button"
          className={`chip${value.includes(c) ? " on" : ""}`}
          aria-pressed={value.includes(c)}
          onClick={() => onToggle(c)}
        >
          <ColorDot color={c} />
          {COLORS[c].label}
        </button>
      ))}
    </div>
  );
}

/** 画面に出すエラーの文。ブラウザが英語で返すよくあるもの（通信できない・容量が足りない）は、分かる言葉にする */
export function errorMessage(e: unknown): string {
  if ((e as { name?: unknown } | null)?.name === "QuotaExceededError") {
    return "端末の空き容量が足りず、保存できませんでした。いらない写真やアプリを消してから、もう一度試してください";
  }
  // Chrome は "Failed to fetch"、Safari は "Load failed"、Firefox は "NetworkError …"
  if (e instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(e.message)) {
    return "通信できませんでした。電波のよいところで、もう一度試してください";
  }
  return e instanceof Error ? e.message : String(e);
}
