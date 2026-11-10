// コーデを3案。画面を開いたらすぐ出し、条件はタップで変えるだけ（変えたら出し直す）。
import { CalendarCheck, Check, Heart, Plus, RefreshCw, Shirt, SlidersHorizontal, ThumbsDown, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClosetAI } from "../ai";
import { errorMessage, GarmentThumb } from "../components/common";
import type { BodyScan } from "../body/types";
import type { Profile } from "../domain/profile";
import { BtnText, FEEL_ICONS, ICON, Icon, PURPOSE_ICONS } from "../components/icons";
import { PURPOSES, PURPOSE_LABELS, toInfo, type Feedback, type Garment, type Outfit, type Purpose, type WearRecord } from "../domain/types";
import { dayKey, recentWears } from "../domain/wear";
import { LookPhotos, OutfitLook } from "./OutfitLook";
import { FEELS, feelForTemperature, loadConditions, saveConditions, temperatureFor, type Feel } from "../storage/conditions";
import { WeatherButton } from "../weather/WeatherButton";

/** トップスとボトムス、またはワンピースがあれば組める */
export function canSuggestOutfits(garments: Garment[]): boolean {
  const has = (c: Garment["category"]) => garments.some((g) => g.category === c);
  return (has("tops") && has("bottoms")) || has("onepiece");
}

export function OutfitScreen({
  ai,
  garments,
  feedback,
  onFeedback,
  wears,
  onWear,
  initialMustInclude = [],
  onGoCloset,
  profile,
  bodyScan,
}: {
  ai: ClosetAI;
  profile: Profile;
  /** 体の写真から作った体型。なければ身長・体重から */
  bodyScan?: BodyScan;
  garments: Garment[];
  feedback: Feedback[];
  onFeedback: (f: Feedback) => Promise<void>;
  wears: WearRecord[];
  /** 「今日はこれ」。同じ案をもう一度押したら取り消す（null） */
  onWear: (o: Outfit | null) => Promise<void>;
  /** クローゼットの「この服でコーデ」から来たときの服 */
  initialMustInclude?: string[];
  onGoCloset: () => void;
}) {
  const [initial] = useState(loadConditions);
  const [feel, setFeel] = useState<Feel>(initial.feel);
  const [purpose, setPurpose] = useState<Purpose>(initial.purpose);
  const [mustInclude, setMustInclude] = useState<string[]>(initialMustInclude);
  const [picking, setPicking] = useState(false);
  const [preferenceInput, setPreferenceInput] = useState("");
  const [preference, setPreference] = useState("");
  /** 「ほかの案」で何回めか。条件を変えたら0に戻す */
  const [page, setPage] = useState(0);
  const [outfits, setOutfits] = useState<Outfit[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const shownRef = useRef<string[]>([]);
  const seqRef = useRef(0);
  // 評価を押すたびに出し直さないよう、評価は最新のものを参照だけする
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;

  const byId = new Map(garments.map((g) => [g.id, g]));
  const itemsOf = (o: Outfit) => o.garmentIds.flatMap((id) => byId.get(id) ?? []);
  const ratings = new Map(feedback.map((f) => [f.outfitKey, f.liked]));
  const ready = canSuggestOutfits(garments);
  // 服の中身が変わったときだけ出し直す（評価のたびに配列が作り直されても無視する）
  const closetJson = useMemo(() => JSON.stringify(garments.map(toInfo)), [garments]);
  const profileJson = JSON.stringify(profile);
  const validMustInclude = mustInclude.filter((id) => byId.has(id));
  const mustKey = validMustInclude.join(",");
  const today = dayKey(new Date());
  const todayWear = wears.find((w) => w.day === today);
  // 昨日までの「着た」記録。今日の分を押しても出し直さない
  const recentJson = JSON.stringify(recentWears(wears, today));

  useEffect(() => {
    if (!ready) return;
    const seq = ++seqRef.current;
    if (page === 0) shownRef.current = [];
    setLoading(true);
    setError(undefined);
    ai.suggestOutfits({
      closet: JSON.parse(closetJson),
      request: {
        mustInclude: mustKey ? mustKey.split(",") : [],
        temperatureC: temperatureFor(feel),
        purpose,
        preference: preference || undefined,
        exclude: shownRef.current.length ? shownRef.current : undefined,
        recentlyWorn: JSON.parse(recentJson),
      },
      feedback: feedbackRef.current,
      profile: JSON.parse(profileJson),
    })
      .then((result) => {
        if (seq !== seqRef.current) return;
        shownRef.current = [...shownRef.current, ...result.map((o) => o.key)];
        setOutfits(result);
      })
      .catch((e) => seq === seqRef.current && setError(errorMessage(e)))
      .finally(() => seq === seqRef.current && setLoading(false));
  }, [ai, ready, closetJson, profileJson, mustKey, feel, purpose, preference, page, recentJson]);

  // 条件を変えたら「ほかの案」の続きはやめて、最初から出し直す
  function change(apply: () => void) {
    apply();
    setPage(0);
  }

  function chooseFeel(f: Feel) {
    change(() => setFeel(f));
    saveConditions({ feel: f, purpose });
  }
  function choosePurpose(p: Purpose) {
    change(() => setPurpose(p));
    saveConditions({ feel, purpose: p });
  }
  const toggle = (id: string) =>
    change(() => setMustInclude((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-3))));

  if (!ready) {
    return (
      <section className="panel">
        <h2>今日のコーデ</h2>
        <p className="empty">
          コーデを出すには、トップスとボトムスを1着ずつ（またはワンピース）登録してください。
        </p>
        <button className="btn primary wide" onClick={onGoCloset} title="服を登録する">
          <Plus {...ICON} />
          <BtnText text="服を登録する" short="服を登録" />
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>今日のコーデ</h2>

      <div className="conditions">
        <div className="chips scroll" role="group" aria-label="体感の気温">
          {FEELS.map((f) => (
            <button key={f.id} type="button" className={`chip${feel === f.id ? " on" : ""}`} aria-pressed={feel === f.id} onClick={() => chooseFeel(f.id)}>
              <Icon of={FEEL_ICONS[f.id]} />
              {f.label}
            </button>
          ))}
        </div>
        <WeatherButton onTemperature={(c) => chooseFeel(feelForTemperature(c))} />
        <div className="chips scroll" role="group" aria-label="出かける目的">
          {PURPOSES.map((p) => (
            <button key={p} type="button" className={`chip${purpose === p ? " on" : ""}`} aria-pressed={purpose === p} onClick={() => choosePurpose(p)}>
              <Icon of={PURPOSE_ICONS[p]} />
              {PURPOSE_LABELS[p]}
            </button>
          ))}
        </div>

        <div className="row between must">
          <div className="must-list">
            {validMustInclude.length === 0 ? (
              <span className="hint">使いたい服：おまかせ</span>
            ) : (
              validMustInclude.map((id) => (
                <span key={id} className="must-item">
                  <GarmentThumb garment={byId.get(id)!} size="sm" onClick={() => toggle(id)} />
                </span>
              ))
            )}
          </div>
          <button className="btn" onClick={() => setPicking(!picking)} aria-expanded={picking} title={picking ? "閉じる" : "使いたい服を選ぶ"}>
            {picking ? <X {...ICON} /> : <Shirt {...ICON} />}
            {picking ? <BtnText text="閉じる" /> : <BtnText text="使いたい服" short="使う服" />}
          </button>
        </div>
        {picking && (
          <>
            <p className="hint">3着まで選べます。もう一度タップで外します。</p>
            <div className="grid small">
              {garments.map((g) => (
                <GarmentThumb key={g.id} garment={g} size="sm" selected={mustInclude.includes(g.id)} onClick={() => toggle(g.id)} />
              ))}
            </div>
          </>
        )}

        <details className="more">
          <summary>
            <SlidersHorizontal {...ICON} />
            こだわり <span className="hint">{preference || "例：明るめ、楽な服"}</span>
          </summary>
          <form
            className="row more-body"
            onSubmit={(e) => {
              e.preventDefault();
              change(() => setPreference(preferenceInput.trim()));
            }}
          >
            <input
              className="text"
              value={preferenceInput}
              placeholder="明るめ、楽な服 など"
              onChange={(e) => setPreferenceInput(e.target.value)}
              maxLength={300}
              enterKeyHint="done"
            />
            <button className="btn" type="submit" title="反映">
              <Check {...ICON} />
              <BtnText text="反映" />
            </button>
          </form>
        </details>
      </div>

      {todayWear && todayWear.garmentIds.length > 0 && (
        <div className="today-wear" role="status">
          <CalendarCheck {...ICON} />
          <span className="grow">今日はこれ</span>
          <span className="must-list">
            {todayWear.garmentIds.flatMap((id) => {
              const g = byId.get(id);
              return g ? [<span key={id} className="must-item"><GarmentThumb garment={g} size="sm" /></span>] : [];
            })}
          </span>
          <button className="btn ghost small" onClick={() => onWear(null)} title="今日はこれを取り消す">
            <Undo2 {...ICON} />
            <BtnText text="取り消す" />
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && !outfits && <p className="hint">考え中…</p>}

      <div className={loading ? "results loading" : "results"} aria-busy={loading}>
        {outfits && outfits.length === 0 && (
          <p className="empty">
            {page > 0
              ? "この条件で出せる組み合わせは、これで全部です。"
              : "条件に合う組み合わせが見つかりませんでした。使いたい服を外すか、気温を変えてみてください。"}
          </p>
        )}
        {outfits?.map((o, i) => (
          <article key={o.key} className="outfit">
            <h3>
              案{page * 3 + i + 1}：{o.title}
            </h3>
            <OutfitLook items={itemsOf(o)} profile={profile} bodyScan={bodyScan}>
              {o.garmentIds.map((id) => {
                const g = byId.get(id);
                return g ? <GarmentThumb key={id} garment={g} size="sm" /> : null;
              })}
            </OutfitLook>
            <ul>
              {o.explanation.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
            <LookPhotos items={itemsOf(o)} profile={profile} />
            <div className="actions">
              <button
                className={`btn wear${todayWear?.outfitKey === o.key ? " on" : ""}`}
                aria-pressed={todayWear?.outfitKey === o.key}
                onClick={() => onWear(todayWear?.outfitKey === o.key ? null : o)}
                title={todayWear?.outfitKey === o.key ? "今日はこれにした" : "今日はこれ"}
              >
                <CalendarCheck {...ICON} />
                <BtnText text={todayWear?.outfitKey === o.key ? "今日はこれにした" : "今日はこれ"} short="今日" />
              </button>
              <span className="grow" />
              <button
                className={`btn icon-only like${ratings.get(o.key) === true ? " on" : ""}`}
                aria-pressed={ratings.get(o.key) === true}
                aria-label="好き"
                title="好き"
                onClick={() => onFeedback({ outfitKey: o.key, garmentIds: o.garmentIds, liked: true, at: Date.now() })}
              >
                <Heart size={22} aria-hidden fill={ratings.get(o.key) === true ? "currentColor" : "none"} />
              </button>
              <button
                className={`btn icon-only dislike${ratings.get(o.key) === false ? " on" : ""}`}
                aria-pressed={ratings.get(o.key) === false}
                aria-label="好みじゃない"
                title="好みじゃない"
                onClick={() => onFeedback({ outfitKey: o.key, garmentIds: o.garmentIds, liked: false, at: Date.now() })}
              >
                <ThumbsDown size={22} aria-hidden fill={ratings.get(o.key) === false ? "currentColor" : "none"} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {outfits && (outfits.length > 0 || page > 0) && (
        <button
          className="btn wide"
          disabled={loading}
          onClick={() => (outfits.length === 0 ? setPage(0) : setPage(page + 1))}
          title={loading ? "考え中…" : outfits.length === 0 && page > 0 ? "最初の案にもどる" : "ほかの案を見る"}
        >
          <RefreshCw {...ICON} className={loading ? "spin" : undefined} />
          {loading ? (
            "考え中…"
          ) : outfits.length === 0 && page > 0 ? (
            <BtnText text="最初の案にもどる" short="最初へ" />
          ) : (
            <BtnText text="ほかの案を見る" short="ほかの案" />
          )}
        </button>
      )}
    </section>
  );
}
