import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { COLORS, shortLabel } from "../domain/colors";
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

export function GarmentThumb({
  garment,
  selected,
  onClick,
  size = "md",
  caption,
}: {
  garment: Garment;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
  /** 名前の下に小さく出す補足（「3日前」など） */
  caption?: string;
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
      <span className="thumb-label">
        <ColorDot color={garment.color} />
        {garment.subColor && garment.subColor !== garment.color && <ColorDot color={garment.subColor} />}
        {label}
      </span>
      {caption && <span className="thumb-caption">{caption}</span>}
    </Tag>
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
