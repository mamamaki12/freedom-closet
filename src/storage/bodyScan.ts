// 体の写真から読み取った体型（数字だけ）を端末に保存する。写真は保存しない。
// コーデの提案でClaudeに送る情報（Profile）とは分けておき、外に送らない。
import type { BodyScan } from "../body/types";

const KEY = "freedom-closet:body-scan";

export function loadBodyScan(): BodyScan | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as BodyScan) : undefined;
    return v?.version === 1 && Array.isArray(v.torso) && Array.isArray(v.legs) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function saveBodyScan(scan: BodyScan | undefined) {
  try {
    if (scan) localStorage.setItem(KEY, JSON.stringify(scan));
    else localStorage.removeItem(KEY);
  } catch {
    // 保存できなくても、開いているあいだは使える
  }
}
