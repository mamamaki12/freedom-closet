// 条件を選んでコーデを3案出し、「好き・好みじゃない」を記録する。
import { useState } from "react";
import type { ClosetAI } from "../ai";
import { errorMessage, GarmentThumb } from "../components/common";
import {
  PURPOSES,
  PURPOSE_LABELS,
  toInfo,
  type Feedback,
  type Garment,
  type Outfit,
  type Purpose,
} from "../domain/types";

export function OutfitScreen({
  ai,
  garments,
  feedback,
  onFeedback,
}: {
  ai: ClosetAI;
  garments: Garment[];
  feedback: Feedback[];
  onFeedback: (f: Feedback) => Promise<void>;
}) {
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [temperature, setTemperature] = useState<string>("");
  const [purpose, setPurpose] = useState<Purpose>("everyday");
  const [preference, setPreference] = useState("");
  const [outfits, setOutfits] = useState<Outfit[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const byId = new Map(garments.map((g) => [g.id, g]));
  const ratings = new Map(feedback.map((f) => [f.outfitKey, f.liked]));

  async function suggest() {
    setLoading(true);
    setError(undefined);
    try {
      const t = temperature.trim() === "" ? undefined : Number(temperature);
      const result = await ai.suggestOutfits({
        closet: garments.map(toInfo),
        request: {
          mustInclude,
          temperatureC: t !== undefined && Number.isFinite(t) ? t : undefined,
          purpose,
          preference: preference.trim() || undefined,
        },
        feedback,
      });
      setOutfits(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const toggle = (id: string) =>
    setMustInclude((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-3)));

  return (
    <section className="panel">
      <h2>コーデを考える</h2>

      <fieldset>
        <legend>使いたい服（任意・3着まで）</legend>
        {garments.length === 0 ? (
          <p className="empty">先にクローゼットに服を登録してください。</p>
        ) : (
          <div className="grid small">
            {garments.map((g) => (
              <GarmentThumb key={g.id} garment={g} size="sm" selected={mustInclude.includes(g.id)} onClick={() => toggle(g.id)} />
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="row wrap">
        <label className="field">
          気温（℃）
          <input
            className="text short"
            type="number"
            inputMode="numeric"
            value={temperature}
            placeholder="例：18"
            onChange={(e) => setTemperature(e.target.value)}
          />
        </label>
        <label className="field">
          出かける目的
          <select className="text" value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <input
        className="text"
        value={preference}
        placeholder="好み（任意）例：明るめ、楽な服"
        onChange={(e) => setPreference(e.target.value)}
        maxLength={300}
      />

      <button className="btn primary wide" onClick={suggest} disabled={loading || garments.length === 0}>
        {loading ? "考え中…" : "3案出す"}
      </button>
      {error && <p className="error">{error}</p>}

      {outfits && outfits.length === 0 && (
        <p className="empty">条件に合う組み合わせが見つかりませんでした。使いたい服を減らすか、トップス・ボトムスを追加してください。</p>
      )}
      {outfits?.map((o, i) => (
        <article key={o.key} className="outfit">
          <h3>
            案{i + 1}：{o.title}
          </h3>
          <div className="grid small">
            {o.garmentIds.map((id) => {
              const g = byId.get(id);
              return g ? <GarmentThumb key={id} garment={g} size="sm" /> : null;
            })}
          </div>
          <ul>
            {o.explanation.map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
          <div className="actions">
            <button
              className={`btn${ratings.get(o.key) === true ? " primary" : ""}`}
              onClick={() => onFeedback({ outfitKey: o.key, garmentIds: o.garmentIds, liked: true, at: Date.now() })}
            >
              好き
            </button>
            <button
              className={`btn${ratings.get(o.key) === false ? " primary" : ""}`}
              onClick={() => onFeedback({ outfitKey: o.key, garmentIds: o.garmentIds, liked: false, at: Date.now() })}
            >
              好みじゃない
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
