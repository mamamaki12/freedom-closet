// 体の写真から出した胸囲・ウエストなどの目安（cm）。服のサイズ選びに使えるように、目安のずれ（±）も出す。
import { Ruler } from "lucide-react";
import { estimateSizes, SIZE_LABELS, type SizeKey } from "../body/sizes";
import type { BodyScan } from "../body/types";
import type { Profile } from "../domain/profile";

/** 画面に出す項目（肩幅とふくらはぎは、服のサイズ表の測り方と違ったり使わなかったりするので出さない） */
const SHOWN: SizeKey[] = ["chest", "waist", "hip", "thigh"];

export function BodySizes({ scan, profile }: { scan: BodyScan; profile: Profile }) {
  if (scan.loose)
    return <p className="hint">ゆったりした服の写真なので、胸囲・ウエストなどの目安（cm）は出していません（服の分だけ大きく出るため）。下着か、体にぴったりした服で撮り直すと出せます。</p>;
  if (!scan.marks) return <p className="hint">撮り直すと、胸囲・ウエストなどの目安（cm）も出せます。</p>;
  const sizes = estimateSizes(scan, profile)?.filter((s) => SHOWN.includes(s.key));
  if (!sizes) return <p className="hint">身長を設定すると、胸囲・ウエストなどの目安（cm）も出せます。</p>;
  return (
    <div className="body-sizes">
      <h4 className="with-icon">
        <Ruler size={16} aria-hidden />
        採寸の目安
      </h4>
      <dl>
        {sizes.map((s) => (
          <div key={s.key}>
            <dt>{SIZE_LABELS[s.key]}</dt>
            <dd>
              {Math.round(s.cm)}
              <small>cm（±{Math.max(1, Math.round(s.error))}）</small>
            </dd>
          </div>
        ))}
      </dl>
      <p className="hint">
        写真と身長{profile.weightKg ? "・体重" : ""}から出した目安です。±は、実在の人400人で確かめた平均のずれです。
        {!profile.weightKg && "体重も設定すると、もっと正確になります。"}
      </p>
    </div>
  );
}
