// 登録済みの服を直す・消す。ここから「この服でコーデ」にも進める。
import { useState } from "react";
import { errorMessage } from "../components/common";
import { CATEGORY_LABELS, toInfo, type Garment } from "../domain/types";
import { GarmentEditor, type Draft } from "./GarmentEditor";

export function EditGarment({
  garment,
  onSave,
  onDelete,
  onClose,
  onStyle,
}: {
  garment: Garment;
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

  const save = () =>
    run(() => onSave({ ...garment, ...draft, subType: draft.subType.trim() || CATEGORY_LABELS[draft.category] }));

  return (
    <section className="panel">
      <div className="row between">
        <button className="btn ghost" onClick={onClose} disabled={busy}>
          ← もどる
        </button>
        <button className="btn" onClick={onStyle} disabled={busy}>
          この服でコーデ
        </button>
      </div>

      <GarmentEditor photo={garment.photo} value={draft} onChange={setDraft} />
      {error && <p className="error">{error}</p>}

      <div className="sticky-actions">
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => {
            // 間違えて消さないよう、2回押したら削除
            if (!confirmDelete) return setConfirmDelete(true);
            void run(onDelete);
          }}
        >
          {confirmDelete ? "もう一度押すと削除" : "削除"}
        </button>
        <button className="btn primary grow" onClick={save} disabled={busy}>
          保存
        </button>
      </div>
    </section>
  );
}
