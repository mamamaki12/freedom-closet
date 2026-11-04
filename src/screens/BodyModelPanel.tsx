// 設定の「体の3Dモデル」。今の体型を回して見られ、写真から作り直したり消したりできる。
import { PersonStanding, ScanLine, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Viewer3D } from "../body/Figure3D";
import { defaultScan } from "../body/measure";
import type { BodyScan } from "../body/types";
import { BodySizes } from "../components/BodySizes";
import { ICON } from "../components/icons";
import { bodyShape } from "../domain/look";
import type { Profile } from "../domain/profile";

export function BodyModelPanel({
  profile,
  scan,
  onScan,
  onDelete,
}: {
  profile: Profile;
  scan?: BodyScan;
  onScan: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const profileJson = JSON.stringify(profile);
  const body = useMemo(() => scan ?? defaultScan(JSON.parse(profileJson)), [scan, profileJson]);
  const scale = bodyShape(profile).scale;
  return (
    <fieldset>
      <legend className="with-icon">
        <PersonStanding {...ICON} />
        体の3Dモデル
      </legend>
      <p className="hint">
        {scan
          ? `体の写真から作った体型です（${new Date(scan.at).toLocaleDateString("ja-JP")}）。コーデの「着たときのイメージ」に使います。`
          : "今は身長・体重から作った標準の体型です。体の写真（正面・横向き）を撮ると、あなたの体型で作り直します。"}
      </p>
      <div className="body-preview">
        <Viewer3D scan={body} items={[]} scale={scale} />
      </div>
      {scan && <BodySizes scan={scan} profile={profile} />}
      <div className="row wrap">
        <button className="btn primary" onClick={onScan}>
          <ScanLine {...ICON} />
          {scan ? "写真で作り直す" : "体の写真で作る"}
        </button>
        {scan && (
          <button
            className="btn danger"
            onClick={() => {
              if (!confirm) return setConfirm(true);
              setConfirm(false);
              onDelete();
            }}
          >
            <Trash2 {...ICON} />
            {confirm ? "もう一度押すと消します" : "体型を消す"}
          </button>
        )}
      </div>
    </fieldset>
  );
}
