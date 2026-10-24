import { useState } from "react";
import { errorMessage } from "../components/common";
import { currentPosition, fetchWeather, outingTemperature, type Weather } from "./openMeteo";

export function WeatherButton({ onTemperature }: { onTemperature: (c: number) => void }) {
  const [weather, setWeather] = useState<Weather>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const pos = await currentPosition();
      const w = await fetchWeather(pos.lat, pos.lon);
      setWeather(w);
      onTemperature(outingTemperature(w));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="weather">
      <button type="button" className="btn" onClick={load} disabled={loading}>
        {loading ? "取得中…" : "現在地の気温を入れる"}
      </button>
      {weather && (
        <span className="hint">
          今{Math.round(weather.currentC)}℃・最高{Math.round(weather.maxC)}℃・最低{Math.round(weather.minC)}℃（天気：
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo
          </a>
          ）
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
