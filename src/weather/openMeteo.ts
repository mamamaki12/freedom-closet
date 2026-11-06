// 現在地の気温を Open-Meteo（APIキー不要の天気API）から取る。
// 送るのは緯度・経度だけで、細かい位置が分からないよう小数2桁（約1km）に丸める。
// Open-Meteo の無料枠は非商用向け。アプリで収益化するときは有料プランか別のAPIを検討する。

export interface Weather {
  currentC: number;
  maxC: number;
  minC: number;
}

type Fetch = typeof fetch;

export function weatherUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: "temperature_2m",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/** 気温が分からないときに添える、代わりのやり方 */
const PICK_BY_HAND = "気温は上の「寒い〜暑い」からも選べます";

export async function fetchWeather(lat: number, lon: number, fetchImpl: Fetch = (...a) => fetch(...a)): Promise<Weather> {
  const res = await fetchImpl(weatherUrl(lat, lon), { signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw new Error(`天気を取得できませんでした。通信を確かめてください。${PICK_BY_HAND}`);
  });
  if (!res.ok) throw new Error(`天気を取得できませんでした（${res.status}）。${PICK_BY_HAND}`);
  const json = (await res.json()) as {
    current?: { temperature_2m?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  };
  const currentC = json.current?.temperature_2m;
  const maxC = json.daily?.temperature_2m_max?.[0];
  const minC = json.daily?.temperature_2m_min?.[0];
  if ([currentC, maxC, minC].some((v) => typeof v !== "number")) throw new Error(`天気の形式が想定と違いました。${PICK_BY_HAND}`);
  return { currentC: currentC!, maxC: maxC!, minC: minC! };
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error(`この端末では位置情報を使えません。${PICK_BY_HAND}`));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? `位置情報の利用が許可されていません。使うときは、端末の設定でブラウザに位置情報を許可してください。${PICK_BY_HAND}`
              : `現在地を取得できませんでした。電波のよいところでもう一度試してください。${PICK_BY_HAND}`,
          ),
        ),
      // 気温が分かればよいので、粗い位置で早く返してもらう
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30 * 60_000 },
    );
  });
}

/** 出かけている間の気温の目安。日中に出かける前提で、最高気温寄りにする */
export function outingTemperature(w: Weather): number {
  return Math.round((w.maxC * 2 + w.minC) / 3);
}
