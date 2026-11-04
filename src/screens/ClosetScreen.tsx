// クローゼット。種類ごとに並べる。上の絞り込みで「確認したい服」「しばらく着ていない服」だけも見られる。
import { Archive, HelpCircle, Plus } from "lucide-react";
import { useState } from "react";
import { GarmentThumb } from "../components/common";
import { ICON } from "../components/icons";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Garment, type WearRecord } from "../domain/types";
import { daysAgoLabel, idleGarments, lastWornMap } from "../domain/wear";
import type { BackupReminder } from "../storage/backupReminder";
import { PhotoPickers } from "./AddGarments";

type Filter = "all" | "review" | "idle" | Category;

export function ClosetScreen({
  garments,
  wears,
  onAdd,
  onEdit,
  backupReminder,
  onBackupNow,
  onSnoozeBackup,
}: {
  garments: Garment[];
  wears: WearRecord[];
  /** 写真を選んでから開くときは files が入る */
  onAdd: (files?: File[]) => void;
  onEdit: (g: Garment) => void;
  /** しばらくバックアップしていないときのお知らせ */
  backupReminder?: BackupReminder | null;
  onBackupNow?: () => void;
  onSnoozeBackup?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  if (garments.length === 0) {
    return (
      <section className="panel">
        <h2>まずは服を登録しましょう</h2>
        <p className="hint">写真を選ぶと、種類と色と柄は自動で入ります。アルバムからなら何枚でもまとめて選べます。</p>
        <PhotoPickers onPick={onAdd} />
        <p className="hint">トップス・ボトムスを2〜3着ずつ入れると、コーデを提案できるようになります。</p>
      </section>
    );
  }

  const review = garments.filter((g) => g.needsReview);
  const idle = idleGarments(garments, wears);
  const lastWorn = lastWornMap(wears);
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

  const caption = (g: Garment) => {
    const day = lastWorn.get(g.id);
    return day ? `${daysAgoLabel(day)}に着た` : wears.length > 0 ? "まだ記録なし" : undefined;
  };

  return (
    <section className="panel">
      <div className="row between">
        <h2>クローゼット（{garments.length}着）</h2>
        <button className="btn primary" onClick={() => onAdd()}>
          <Plus {...ICON} />
          服を追加
        </button>
      </div>

      {backupReminder && (
        <div className="banner" role="status" style={{ cursor: "default" }}>
          <Archive {...ICON} />
          <span className="grow">
            {backupReminder.kind === "never"
              ? "服の写真は、この端末の中にだけ保存されています。機種変更や故障に備えて、バックアップを書き出しておきましょう。"
              : `前回のバックアップから${backupReminder.days}日たち、そのあと服が増えました。新しいバックアップを書き出しておきましょう。`}
            <span className="row" style={{ gap: 8, marginTop: 6 }}>
              <button type="button" className="btn small primary" onClick={onBackupNow}>
                書き出す
              </button>
              <button type="button" className="btn small ghost" onClick={onSnoozeBackup}>
                あとで
              </button>
            </span>
          </span>
        </div>
      )}

      {review.length > 0 && active !== "review" && (
        <button className="banner" onClick={() => setFilter("review")}>
          <HelpCircle {...ICON} />
          <span>
            自動判定に自信がない服が<strong>{review.length}着</strong>あります。ざっと見て、違っていれば直してください。
          </span>
        </button>
      )}

      <div className="chips scroll" role="tablist" aria-label="絞り込み">
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
          <p className="hint">服をタップすると、直したり、その服でコーデを見たりできます。</p>
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
                    <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <p className="hint">
            {active === "review"
              ? "タップして開き、合っていればそのまま保存すると目印が消えます。"
              : active === "idle"
                ? "30日以上「今日はこれ」に入っていない服です。コーデ画面の「使いたい服」に入れると出番が作れます。"
                : "服をタップすると、直したり、その服でコーデを見たりできます。"}
          </p>
          <div className="grid">
            {(active === "review" ? review : active === "idle" ? idle : garments.filter((g) => g.category === active)).map((g) => (
              <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} caption={active === "idle" ? caption(g) : undefined} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
