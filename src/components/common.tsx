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

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
