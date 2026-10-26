// 買い足し提案。買う服の種類・色を決めて、ユニクロ・GUの公式サイトの検索結果へつなぐ。
import { Check, Ruler, Search, ShoppingBag, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClosetAI } from "../ai";
import { ColorChips, ColorDot, errorMessage, GarmentThumb } from "../components/common";
import { ICON } from "../components/icons";
import { colorLabel } from "../domain/colors";
import { recommendSize, type Profile } from "../domain/profile";
import { CATEGORY_LABELS, toInfo, type ColorName, type Feedback, type Garment, type PurchaseSuggestion } from "../domain/types";
import { findCurated } from "../shop/curated";
import { searchLinks } from "../shop/links";

export function ShopScreen({
  ai,
  garments,
  feedback,
  profile,
  onGoSettings,
}: {
  ai: ClosetAI;
  garments: Garment[];
  feedback: Feedback[];
  profile: Profile;
  onGoSettings: () => void;
}) {
  const [avoidColors, setAvoidColors] = useState<ColorName[]>([]);
  const [preferenceInput, setPreferenceInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [extra, setExtra] = useState<{ preference?: string; budgetYen?: number }>({});
  const [result, setResult] = useState<PurchaseSuggestion[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const byId = new Map(garments.map((g) => [g.id, g]));
  const seqRef = useRef(0);
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const closetJson = useMemo(() => JSON.stringify(garments.map(toInfo)), [garments]);
  const profileJson = JSON.stringify(profile);
  const knowsSize = !!(profile.usualSize && Object.values(profile.usualSize).some(Boolean)) || !!(profile.heightCm && profile.fit);

  // 画面を開いたらすぐ提案する。避けたい色を変えたらすぐ出し直す
  useEffect(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(undefined);
    ai.suggestPurchases({
      closet: JSON.parse(closetJson),
      request: { avoidColors, ...extra },
      feedback: feedbackRef.current,
      profile: JSON.parse(profileJson),
    })
      .then((r) => seq === seqRef.current && setResult(r))
      .catch((e) => seq === seqRef.current && setError(errorMessage(e)))
      .finally(() => seq === seqRef.current && setLoading(false));
  }, [ai, closetJson, profileJson, avoidColors, extra]);

  function applyExtra(e: React.FormEvent) {
    e.preventDefault();
    const b = Number(budgetInput);
    setExtra({
      preference: preferenceInput.trim() || undefined,
      budgetYen: budgetInput.trim() && Number.isFinite(b) ? Math.round(b) : undefined,
    });
  }

  const conditionSummary =
    [avoidColors.length ? `${avoidColors.map(colorLabel).join("・")}以外` : "", extra.preference ?? "", extra.budgetYen ? `${extra.budgetYen}円まで` : ""]
      .filter(Boolean)
      .join("／") || "指定なし";

  return (
    <section className="panel">
      <h2>買い足すなら</h2>
      <p className="hint">手持ちの服と合わせやすく、コーデが増える服を選びました。商品はユニクロ・GUの公式サイトで探せます。</p>

      <details className="more">
        <summary>
          <SlidersHorizontal {...ICON} />
          条件を変える <span className="hint">{conditionSummary}</span>
        </summary>
        <div className="more-body">
          <p className="hint">避けたい色</p>
          <ColorChips
            value={avoidColors}
            onToggle={(c) => setAvoidColors((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
          />
          <form className="row wrap" onSubmit={applyExtra}>
            <input
              className="text"
              value={preferenceInput}
              placeholder="好み（任意）例：きれいめ、楽な服"
              onChange={(e) => setPreferenceInput(e.target.value)}
              maxLength={300}
            />
            <label className="field">
              予算（円・任意）
              <input
                className="text short"
                type="number"
                inputMode="numeric"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
              />
            </label>
            <button className="btn" type="submit">
              <Check {...ICON} />
              反映
            </button>
          </form>
        </div>
      </details>

      {!knowsSize && (
        <p className="hint">
          <button className="link" onClick={onGoSettings}>
            設定
          </button>
          で身長やいつものサイズを入れると、買うときのサイズの目安も出ます。
        </p>
      )}
      {loading && <p className="hint">考え中…</p>}
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
            {(() => {
              const size = recommendSize(profile, s.category);
              return (
                size && (
                  <p className="with-icon size-hint">
                    <Ruler {...ICON} />
                    サイズの目安：<strong>{size.size}</strong>
                    <span className="hint">{size.basis === "usual" ? "（いつものサイズ）" : "（身長・体重から）"}</span>
                  </p>
                )
              );
            })()}
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
                  <ShoppingBag {...ICON} />
                  {c.store}：{c.name}
                </a>
              ))}
              {searchLinks(s.searchQuery).map((l) => (
                <a key={l.store} className="btn" href={l.url} target="_blank" rel="noopener noreferrer">
                  <Search {...ICON} />
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
