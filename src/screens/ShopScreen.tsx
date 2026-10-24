// 買い足し提案。買う服の種類・色を決めて、ユニクロ・GUの公式サイトの検索結果へつなぐ。
import { useState } from "react";
import type { ClosetAI } from "../ai";
import { ColorChips, ColorDot, errorMessage, GarmentThumb } from "../components/common";
import { colorLabel } from "../domain/colors";
import { CATEGORY_LABELS, toInfo, type ColorName, type Feedback, type Garment, type PurchaseSuggestion } from "../domain/types";
import { findCurated } from "../shop/curated";
import { searchLinks } from "../shop/links";

export function ShopScreen({ ai, garments, feedback }: { ai: ClosetAI; garments: Garment[]; feedback: Feedback[] }) {
  const [avoidColors, setAvoidColors] = useState<ColorName[]>([]);
  const [preference, setPreference] = useState("");
  const [budget, setBudget] = useState("");
  const [result, setResult] = useState<PurchaseSuggestion[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const byId = new Map(garments.map((g) => [g.id, g]));

  async function suggest() {
    setLoading(true);
    setError(undefined);
    try {
      const b = Number(budget);
      setResult(
        await ai.suggestPurchases({
          closet: garments.map(toInfo),
          request: {
            avoidColors,
            preference: preference.trim() || undefined,
            budgetYen: budget.trim() && Number.isFinite(b) ? Math.round(b) : undefined,
          },
          feedback,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>買い足すなら</h2>
      <p className="hint">手持ちの服と合わせやすく、コーデが増える服を選びます。商品はユニクロ・GUの公式サイトで探せます。</p>

      <fieldset>
        <legend>避けたい色</legend>
        <ColorChips
          value={avoidColors}
          onToggle={(c) => setAvoidColors((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
        />
      </fieldset>
      <div className="row wrap">
        <input
          className="text"
          value={preference}
          placeholder="好み（任意）例：きれいめ、楽な服"
          onChange={(e) => setPreference(e.target.value)}
          maxLength={300}
        />
        <label className="field">
          予算（円・任意）
          <input className="text short" type="number" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>

      <button className="btn primary wide" onClick={suggest} disabled={loading}>
        {loading ? "考え中…" : "おすすめを見る"}
      </button>
      {error && <p className="error">{error}</p>}
      {result && result.length === 0 && <p className="empty">今の手持ちで十分そうです。服を登録すると提案が変わります。</p>}

      {result?.map((s) => {
        const curated = findCurated(s);
        return (
          <article key={`${s.category}-${s.subType}-${s.color}`} className="outfit">
            <h3>
              <ColorDot color={s.color} />
              {colorLabel(s.color)}の{s.subType}
              <span className="tag">{CATEGORY_LABELS[s.category]}</span>
            </h3>
            <p>{s.reason}</p>
            {s.matchesWith.length > 0 && (
              <>
                <p className="hint">合わせられる手持ちの服</p>
                <div className="grid small">
                  {s.matchesWith.slice(0, 6).map((id) => {
                    const g = byId.get(id);
                    return g ? <GarmentThumb key={id} garment={g} size="sm" /> : null;
                  })}
                </div>
              </>
            )}
            <div className="actions">
              {curated.map((c) => (
                <a key={c.url} className="btn primary" href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.store}：{c.name}
                </a>
              ))}
              {searchLinks(s.searchQuery).map((l) => (
                <a key={l.store} className="btn" href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}
