// コーデ画面の条件（体感の気温・出かける目的）を覚えておく。
// 気温はその日だけ覚え、日が変わったら季節の目安に戻す。
import { PURPOSES, type Purpose } from "../domain/types";

export const FEELS = [
  { id: "cold", label: "寒い", temperatureC: 6 },
  { id: "chilly", label: "肌寒い", temperatureC: 12 },
  { id: "mild", label: "ちょうどいい", temperatureC: 17 },
  { id: "warm", label: "暖かい", temperatureC: 22 },
  { id: "hot", label: "暑い", temperatureC: 28 },
] as const;
export type Feel = (typeof FEELS)[number]["id"];

/** 月ごとの目安（東京あたりの昼間の気温） */
const FEEL_BY_MONTH: Feel[] = ["cold", "cold", "chilly", "mild", "warm", "warm", "hot", "hot", "warm", "mild", "chilly", "cold"];

export interface Conditions {
  feel: Feel;
  purpose: Purpose;
}

const KEY = "freedom-closet:outfit-conditions";

function today(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function feelForMonth(now: Date): Feel {
  return FEEL_BY_MONTH[now.getMonth()];
}

/** 気温（℃）からいちばん近い体感を選ぶ */
export function feelForTemperature(c: number): Feel {
  let best: Feel = FEELS[0].id;
  let gap = Infinity;
  for (const f of FEELS) {
    const d = Math.abs(f.temperatureC - c);
    if (d < gap) {
      gap = d;
      best = f.id;
    }
  }
  return best;
}

export function temperatureFor(feel: Feel): number {
  return FEELS.find((f) => f.id === feel)!.temperatureC;
}

export function loadConditions(now = new Date()): Conditions {
  const fallback: Conditions = { feel: feelForMonth(now), purpose: "everyday" };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as { feel?: string; day?: string; purpose?: string };
    return {
      feel: saved.day === today(now) && FEELS.some((f) => f.id === saved.feel) ? (saved.feel as Feel) : fallback.feel,
      purpose: PURPOSES.includes(saved.purpose as Purpose) ? (saved.purpose as Purpose) : fallback.purpose,
    };
  } catch {
    return fallback;
  }
}

export function saveConditions(c: Conditions, now = new Date()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...c, day: today(now) }));
  } catch {
    // 保存できなくても、この画面を開いている間は使える
  }
}
