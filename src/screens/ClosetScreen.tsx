import { GarmentThumb } from "../components/common";
import { CATEGORIES, CATEGORY_LABELS, type Garment } from "../domain/types";

export function ClosetScreen({
  garments,
  onAdd,
  onEdit,
}: {
  garments: Garment[];
  onAdd: () => void;
  onEdit: (g: Garment) => void;
}) {
  return (
    <section className="panel">
      <div className="row between">
        <h2>クローゼット（{garments.length}着）</h2>
        <button className="btn primary" onClick={onAdd}>
          ＋ 服を追加
        </button>
      </div>
      {garments.length === 0 && (
        <p className="empty">
          まだ服がありません。「服を追加」から1着ずつ撮影してください。
          <br />
          トップス・ボトムスを数着ずつ入れると、コーデを提案できます。
        </p>
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
                <GarmentThumb key={g.id} garment={g} onClick={() => onEdit(g)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
