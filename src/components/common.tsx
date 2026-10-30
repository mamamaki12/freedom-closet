import { useEffect, useState } from "react";
import { COLORS } from "../domain/colors";
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
}: {
  garment: Garment;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}) {
  const url = usePhotoUrl(garment.photo);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`thumb thumb-${size}${selected ? " selected" : ""}`}
      onClick={onClick}
      aria-pressed={onClick ? !!selected : undefined}
    >
      {url && <img src={url} alt={garment.subType} />}
      <span className="thumb-label">
        <ColorDot color={garment.color} />
        {garment.subType}
      </span>
    </Tag>
  );
}

export function ColorDot({ color }: { color: ColorName }) {
  return <span className="color-dot" style={{ background: COLORS[color].hex }} aria-hidden />;
}

export function ColorChips({
  value,
  onToggle,
}: {
  value: ColorName[];
  onToggle: (c: ColorName) => void;
}) {
  return (
    <div className="chips">
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
