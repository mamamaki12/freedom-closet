// クローゼット。種類ごとに並べる。上の絞り込みで「確認したい服」「しばらく着ていない服」だけも見られる。
// 服を登録した直後は、足した服を一番上にまとめ、種類ごとの並びでも「新しい」の印を付ける。
// 「しばらく着てない」は着ていない期間の長い順に並べ、1回のタップでその服のコーデへ進める。
// スマホの最初の画面で服が見えるよう、お知らせは1行にたたみ、説明文は一度見たら出さない。
// 「服を追加」は右下に固定した丸いボタン（スクロールしてもいつでも押せる）。
import { Archive, Bell, ChevronDown, ChevronRight, Clock, Download, Eye, HelpCircle, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { GarmentThumb, useScrollEdges } from "../components/common";
import { shortLabel } from "../domain/colors";
import { BtnText, ICON } from "../components/icons";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Garment, type WearRecord } from "../domain/types";
import { idleGarments, lastWornMap, sinceAddedLabel, wornLabel } from "../domain/wear";
import type { BackupReminder } from "../storage/backupReminder";
import { closedNoticeKey, closetHintSeen, markClosetHintSeen, saveClosedNoticeKey } from "../storage/closetHints";
import { PhotoPickers } from "./AddGarments";
import { closetNotices, noticeKey, noticeSummary } from "./closetNotices";

type Filter = "all" | "review" | "idle" | Category;

export function ClosetScreen({
  garments,
  wears,
  onAdd,
  onEdit,
  onStyle,
  justAdded = [],
  onClearJustAdded,
  setupNote,
  backupReminder,
  onBackupNow,
  onSnoozeBackup,
}: {
  garments: Garment[];
  wears: WearRecord[];
  /** 写真を選んでから開くときは files が入る */
  onAdd: (files?: File[]) => void;
  onEdit: (g: Garment) => void;
  /** この服を使ったコーデを見る */
  onStyle?: (g: Garment) => void;
  /** いま登録したばかりの服の id（登録した順） */
  justAdded?: string[];
  /** 「いま登録した服」のまとめを閉じる */
  onClearJustAdded?: () => void;
  /** AIを使い始める前に知らせること（初回のダウンロードなど） */
  setupNote?: string;
  /** しばらくバックアップしていないときのお知らせ */
  backupReminder?: BackupReminder | null;
  onBackupNow?: () => void;
  onSnoozeBackup?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [closedKey, setClosedKey] = useState(closedNoticeKey);
  // 説明文は、はじめて服が並んだ画面でだけ出す（この画面を開いている間は出したまま）
  const [showHint] = useState(() => !closetHintSeen());
  const noticeId = useId();
  // 絞り込みのチップは横にずらす1行。続きがある側の端を薄くして、まだあると分かるようにする
  const [chipsRef, chipEdges] = useScrollEdges();
  const hasGarments = garments.length > 0;
  useEffect(() => {
    if (hasGarments && showHint) markClosetHintSeen();
  }, [hasGarments, showHint]);

  if (garments.length === 0) {
    return (
      <section className="panel">
        <h2>まずは服を登録しましょう</h2>
        <p className="hint">写真を選ぶと、種類と色と柄は自動で入ります。アルバムからなら何枚でもまとめて選べます。</p>
        <PhotoPickers onPick={onAdd} />
        {setupNote && <p className="hint">{setupNote}</p>}
        <p className="hint">トップス・ボトムスを2〜3着ずつ入れると、コーデを提案できるようになります。</p>
      </section>
    );
  }

  const review = garments.filter((g) => g.needsReview);
  const idle = idleGarments(garments, wears);
  const lastWorn = lastWornMap(wears);
  const newIds = new Set(justAdded);
  // 登録した順に並べる（消した服は除く）
  const byId = new Map(garments.map((g) => [g.id, g]));
  const added = justAdded.flatMap((id) => byId.get(id) ?? []);
  // 選んでいた絞り込みの服がなくなったら（確認し終えたなど）、全部に戻す
  const active: Filter = (filter === "review" && review.length === 0) || (filter === "idle" && idle.length === 0) ? "all" : filter;

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "すべて", count: garments.length },
    ...(review.length ? [{ id: "review" as const, label: "確認したい", count: review.length }] : []),
    ...(idle.length ? [{ id: "idle" as const, label: "しばらく着てない", count: idle.length }] : []),
    ...CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c], count: garments.filter((g) => g.category === c).length })).filter(
      (f) => f.count > 0,
    ),
  ];

  const notices = closetNotices({ backupReminder, reviewCount: review.length, reviewFilterOn: active === "review" });
  const showNotices = notices.length > 0 && closedKey !== noticeKey(notices);
  const closeNotices = () => {
    const key = noticeKey(notices);
    saveClosedNoticeKey(key);
    setClosedKey(key);
    setNoticeOpen(false);
  };
  const summary = noticeSummary(notices, review.length);
  const SummaryIcon = notices.length > 1 ? Bell : notices[0] === "backup" ? Archive : HelpCircle;
  const tapHint = "服をタップすると、直したり、その服でコーデを見たりできます。";

  // 一度も着ていない服は、登録からの長さも出す（並びの理由が分かるように）。「登録から4か月」「記録なし」の2行
  const caption = (g: Garment) => {
    const day = lastWorn.get(g.id);
    if (day) return wornLabel(day);
    return (
      <>
        <span className="caption-line">{sinceAddedLabel(g.createdAt)}</span>
        <span className="sr-only">、</span>
        <span className="caption-line">記録なし</span>
      </>
    );
  };

  return (
    <section className="panel has-fab">
      <h2>クローゼット</h2>

      {showNotices && (
        <div className="closet-notice" role="status">
          <div className="closet-notice-row">
            <button
              type="button"
              className="closet-notice-summary"
              aria-expanded={noticeOpen}
              aria-controls={noticeId}
              onClick={() => setNoticeOpen((v) => !v)}
            >
              <SummaryIcon {...ICON} />
              <span className="closet-notice-text">
                <span className="closet-notice-title">{summary.title}</span>
                {summary.detail && <span className="closet-notice-detail">{summary.detail}</span>}
              </span>
              {noticeOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
            </button>
            <button type="button" className="closet-notice-close" aria-label="お知らせを閉じる" onClick={closeNotices}>
              <X {...ICON} />
            </button>
          </div>
          {noticeOpen && (
            <div id={noticeId} className="closet-notice-body">
              {backupReminder && notices.includes("backup") && (
                <div className="closet-notice-item">
                  <Archive {...ICON} />
                  <span className="grow">
                    {backupReminder.kind === "never"
                      ? "服の写真は、この端末の中にだけ保存されています。機種変更や故障に備えて、バックアップを書き出しておきましょう。"
                      : `前回のバックアップから${backupReminder.days}日たち、そのあと服が増えました。新しいバックアップを書き出しておきましょう。`}
                    <span className="row" style={{ gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn small primary" onClick={onBackupNow} title="バックアップを書き出す">
                        <Download {...ICON} />
                        書き出す
                      </button>
                      <button type="button" className="btn small ghost" onClick={onSnoozeBackup} title="あとで知らせる">
                        <Clock {...ICON} />
                        あとで
                      </button>
                    </span>
                  </span>
                </div>
              )}
              {notices.includes("review") && (
                <div className="closet-notice-item">
                  <HelpCircle {...ICON} />
                  <span className="grow">
                    自動判定に自信がない服が<strong>{review.length}着</strong>あります。ざっと見て、違っていれば直してください。
                    <span className="row" style={{ gap: 8, marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn small primary"
                        title="確認したい服を見る"
                        onClick={() => {
                          setFilter("review");
                          setNoticeOpen(false);
                        }}
                      >
                        <Eye {...ICON} />
                        <BtnText text="確認したい服を見る" short="確認する" />
                      </button>
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={chipsRef} className={`chips scroll${chipEdges}`} role="tablist" aria-label="絞り込み">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={active === f.id}
            className={`chip${active === f.id ? " on" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="count">{f.count}</span>
          </button>
        ))}
      </div>

      {active === "all" ? (
        <>
          {showHint && <p className="hint">{tapHint}</p>}
          {added.length > 0 && (
            <div className="group just-added">
              <div className="just-added-head">
                <h3>いま登録した服（{added.length}）</h3>
                <button type="button" className="icon-btn" onClick={onClearJustAdded} aria-label="まとめを閉じる" title="まとめを閉じる">
                  <X {...ICON} />
                </button>
              </div>
              {/* 小さめの写真で並べ、下の種類ごとの並びを押し下げすぎない */}
              <div className="grid small">
                {added.map((g) => (
                  <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} />
                ))}
              </div>
            </div>
          )}
          {CATEGORIES.map((c) => {
            const items = garments.filter((g) => g.category === c);
            if (items.length === 0) return null;
            return (
              <div key={c} className="group">
                <h3>
                  {CATEGORY_LABELS[c]}（{items.length}）
                </h3>
                <div className="grid">
                  {items.map((g) => (
                    <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} isNew={newIds.has(g.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {active === "review" ? (
            <p className="hint">タップして開き、合っていればそのまま保存すると目印が消えます。</p>
          ) : active === "idle" ? (
            <p className="hint">30日以上「今日はこれ」に入っていない服です（長く着ていない順）。「コーデ」で、その服を入れたコーデを出します。</p>
          ) : (
            showHint && <p className="hint">{tapHint}</p>
          )}
          {active === "idle" ? (
            <div className="grid idle-grid">
              {idle.map((g) => (
                <div key={g.id} className="idle-card">
                  <GarmentThumb garment={g} onClick={() => onEdit(g)} caption={caption(g)} />
                  {onStyle && (
                    <button type="button" className="btn small" onClick={() => onStyle(g)} title="この服でコーデ" aria-label={`${shortLabel(g)}でコーデ`}>
                      <Sparkles {...ICON} />
                      <BtnText text="この服でコーデ" short="コーデ" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid">
              {(active === "review" ? review : garments.filter((g) => g.category === active)).map((g) => (
                <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} isNew={newIds.has(g.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 服を追加：どこまでスクロールしても押せるよう、下のタブのすぐ上の右に固定する */}
      <button type="button" className="btn primary fab" onClick={() => onAdd()} title="服を追加">
        <Plus size={24} strokeWidth={2.2} aria-hidden />
        <BtnText text="服を追加" />
      </button>
    </section>
  );
}
