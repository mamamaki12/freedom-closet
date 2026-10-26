// 身長・体重・いつものサイズ。買い足しのサイズの目安と、コーデの着こなしのひとことに使う。
import { UserRound } from "lucide-react";
import { useState } from "react";
import { ICON } from "../components/icons";
import {
  CLOTHING_SIZES,
  FIT_LABELS,
  FITS,
  SHOE_SIZES,
  SIZE_GROUP_LABELS,
  type Profile,
  type SizeGroup,
} from "../domain/profile";

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  return (
    <label className="field">
      {label}
      <span className="row">
        <input
          className="text short"
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            // 入力の途中（空や範囲外）は保存しない
            if (e.target.value.trim() === "") onChange(undefined);
            else if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n * 10) / 10);
          }}
        />
        {unit}
      </span>
    </label>
  );
}

export function ProfilePanel({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const setSize = (group: SizeGroup, size: string) =>
    onChange({ ...profile, usualSize: { ...profile.usualSize, [group]: profile.usualSize?.[group] === size ? undefined : size } });

  return (
    <fieldset>
      <legend className="with-icon">
        <UserRound {...ICON} />
        あなたについて（任意）
      </legend>
      <p className="hint">
        買い足しで「どのサイズを買えばいいか」の目安と、身長に合った着こなしのひとことに使います。端末の中に保存し、Claude
        APIを使うときだけ提案のために送ります。
      </p>
      <div className="row wrap">
        <NumberField label="身長" unit="cm" min={80} max={230} value={profile.heightCm} onChange={(v) => onChange({ ...profile, heightCm: v })} />
        <NumberField label="体重" unit="kg" min={20} max={250} value={profile.weightKg} onChange={(v) => onChange({ ...profile, weightKg: v })} />
      </div>

      <p className="hint">サイズ表はどちらで見ますか</p>
      <div className="chips">
        {FITS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${profile.fit === f ? " on" : ""}`}
            aria-pressed={profile.fit === f}
            onClick={() => onChange({ ...profile, fit: profile.fit === f ? undefined : f })}
          >
            {FIT_LABELS[f]}
          </button>
        ))}
      </div>

      <p className="hint">いつものサイズ（服を登録するとき自動で入ります）</p>
      {(["tops", "bottoms", "shoes"] as SizeGroup[]).map((group) => (
        <div key={group} className="size-row">
          <span className="size-row-label">{SIZE_GROUP_LABELS[group]}</span>
          <div className="chips scroll">
            {(group === "shoes" ? SHOE_SIZES : CLOTHING_SIZES).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${profile.usualSize?.[group] === s ? " on" : ""}`}
                aria-pressed={profile.usualSize?.[group] === s}
                onClick={() => setSize(group, s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
