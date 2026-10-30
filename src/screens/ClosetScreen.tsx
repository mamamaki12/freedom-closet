import { GarmentThumb } from "../components/common";
import { CATEGORIES, CATEGORY_LABELS, type Garment } from "../domain/types";
import { PhotoPickers } from "./AddGarments";

export function ClosetScreen({
  garments,
  onAdd,
  onEdit,
}: {
  garments: Garment[];
  /** 写真を選んでから開くときは files が入る */
  onAdd: (files?: File[]) => void;
  onEdit: (g: Garment) => void;
}) {
  if (garments.length === 0) {
    return (
      <section className="panel">
        <h2>まずは服を登録しましょう</h2>
        <p className="hint">写真を選ぶと、種類と色は自動で入ります。アルバムからなら何枚でもまとめて選べます。</p>
        <PhotoPickers onPick={(files) => files?.length && onAdd([...files])} />
        <p className="hint">トップス・ボトムスを2〜3着ずつ入れると、コーデを提案できるようになります。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="row between">
        <h2>クローゼット（{garments.length}着）</h2>
        <button className="btn primary" onClick={() => onAdd()}>
          ＋ 服を追加
        </button>
      </div>
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
    </section>
  );
}
