// 登録済みの服を直す・消す。ここから「この服でコーデ」にも進める。
import { ArrowLeft, CalendarCheck, Check, HelpCircle, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../components/common";
import { BtnText, ICON } from "../components/icons";
import { CATEGORY_LABELS, toInfo, type Garment, type WearRecord } from "../domain/types";
import { wearSummaryLine } from "../domain/wear";
import { GarmentEditor, type Draft } from "./GarmentEditor";

export function EditGarment({
  garment,
  wears,
  onSave,
  onDelete,
  onClose,
  onStyle,
}: {
  garment: Garment;
  /** 着た記録（最後に着た日と回数を出す） */
  wears: WearRecord[];
  onSave: (g: Garment) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  /** この服を使ったコーデを見る */
  onStyle: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => {
    const { id: _id, ...info } = toInfo(garment);
    return info;
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  // 保存したら「本人が見た」ことになるので、確認の目印は消す
  const save = () =>
    run(() => {
      const { needsReview: _r, aiConfidence: _c, ...rest } = garment;
      return onSave({ ...rest, ...draft, subType: draft.subType.trim() || CATEGORY_LABELS[draft.category] });
    });

  return (
    <section className="panel">
      <div className="row between">
        <button className="btn ghost icon-only" onClick={onClose} disabled={busy} aria-label="もどる" title="もどる">
          <ArrowLeft size={22} aria-hidden />
        </button>
        <button className="btn" onClick={onStyle} disabled={busy} title="この服でコーデ">
          <Sparkles {...ICON} />
          <BtnText text="この服でコーデ" short="コーデ" />
        </button>
      </div>

      <p className="worn-line">
        <CalendarCheck {...ICON} />
        <span className="sr-only">着た記録：</span>
        {wearSummaryLine(garment.id, wears)}
      </p>

      {garment.needsReview && (
        <p className="status warn with-icon" role="status">
          <HelpCircle {...ICON} />
          この服は自動判定に自信がありません。合っていればそのまま「保存」、違っていれば直してから保存してください。
        </p>
      )}
      <GarmentEditor photo={garment.photo} value={draft} onChange={setDraft} />
      {error && <p className="error">{error}</p>}

      <div className="sticky-actions">
        <button
          className={`btn danger${confirmDelete ? "" : " icon-only"}`}
          disabled={busy}
          aria-label={confirmDelete ? undefined : "削除"}
          title="削除"
          onClick={() => {
            // 間違えて消さないよう、2回押したら削除
            if (!confirmDelete) return setConfirmDelete(true);
            void run(onDelete);
          }}
        >
          <Trash2 {...ICON} />
          {confirmDelete && "もう一度押すと削除"}
        </button>
        <button className="btn primary grow" onClick={save} disabled={busy} title="保存">
          <Check {...ICON} />
          {/* 広いボタンなので、スマホでも「保存」の文字を出す */}
          <BtnText text="保存" short="保存" />
        </button>
      </div>
    </section>
  );
}
