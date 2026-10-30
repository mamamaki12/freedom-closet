import type { GarmentInfo } from "../src/domain/types";

let n = 0;
export function g(partial: Partial<GarmentInfo> & Pick<GarmentInfo, "category" | "color">): GarmentInfo {
  n++;
  return {
    id: partial.id ?? `g${n}`,
    subType: "",
    seasons: [],
    formality: "casual",
    warmth: 2,
    ...partial,
  };
}
