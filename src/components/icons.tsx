// アプリで使うアイコン。どのスマホでも同じ見た目になるよう、絵文字ではなく線画（lucide）を使う。
import {
  Briefcase,
  CloudSun,
  Coffee,
  Gem,
  Mountain,
  Snowflake,
  Sun,
  ThermometerSun,
  Wind,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { Purpose } from "../domain/types";
import type { Feel } from "../storage/conditions";

export const FEEL_ICONS: Record<Feel, LucideIcon> = {
  cold: Snowflake,
  chilly: Wind,
  mild: CloudSun,
  warm: Sun,
  hot: ThermometerSun,
};

export const PURPOSE_ICONS: Record<Purpose, LucideIcon> = {
  everyday: Coffee,
  work: Briefcase,
  date: Wine,
  outdoor: Mountain,
  formal: Gem,
};

/** ボタンや選択肢の中で使うときの大きさ */
export const ICON = { size: 18, strokeWidth: 2, "aria-hidden": true } as const;

/** 表から選んだアイコンを、ボタンの中の大きさで出す */
export function Icon({ of: C }: { of: LucideIcon }) {
  return <C {...ICON} />;
}
