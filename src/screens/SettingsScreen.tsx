import { Bot, ChevronRight, Cloud, Scale, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import type { AISettings } from "../ai";
import { ICON } from "../components/icons";
import type { BodyScan } from "../body/types";
import type { Profile } from "../domain/profile";
import { BodyModelPanel } from "./BodyModelPanel";
import { AccuracyPanel } from "./AccuracyPanel";
import { ProfilePanel } from "./ProfilePanel";

export function SettingsScreen({
  settings,
  onChange,
  profile,
  onProfileChange,
  bodyScan,
  onScanBody,
  onDeleteBodyScan,
  children,
}: {
  settings: AISettings;
  onChange: (s: AISettings) => void;
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  bodyScan?: BodyScan;
  onScanBody: () => void;
  onDeleteBodyScan: () => void;
  /** 設定画面の下に足すパネル（バックアップなど） */
  children?: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>設定</h2>
      <ProfilePanel profile={profile} onChange={onProfileChange} />
      <BodyModelPanel profile={profile} scan={bodyScan} onScan={onScanBody} onDelete={onDeleteBodyScan} />
      <fieldset>
        <legend className="with-icon">
          <Bot {...ICON} />
          使うAI
        </legend>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === "local"}
            onChange={() => onChange({ ...settings, provider: "local" })}
          />
          <span>
            <strong className="with-icon">
              <Smartphone {...ICON} />
              端末内AI
            </strong>
            <br />
            写真も服の情報も端末から出ません。初回だけ判定用のモデルをダウンロードします（大きいのでWi-Fi推奨）。
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === "claude"}
            onChange={() => onChange({ ...settings, provider: "claude" })}
          />
          <span>
            <strong className="with-icon">
              <Cloud {...ICON} />
              Claude API
            </strong>
            <br />
            判定と提案をClaudeが行います。<strong>服を判定するとき、その写真が中継サーバー経由でAnthropicに送られます。</strong>
            コーデ・買い足しの提案では、写真ではなく登録した種類・色などの情報だけを送ります。
          </span>
        </label>
      </fieldset>
      {settings.provider === "claude" && (
        <label className="radio">
          <input
            type="checkbox"
            checked={settings.fallbackToLocal}
            onChange={(e) => onChange({ ...settings, fallbackToLocal: e.target.checked })}
          />
          <span>Claudeにつながらないときは端末内AIで続ける</span>
        </label>
      )}
      {settings.provider === "claude" && (
        <label className="field">
          中継サーバーの合言葉（決めたときだけ）
          <input
            className="text"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={settings.accessCode ?? ""}
            onChange={(e) => onChange({ ...settings, accessCode: e.target.value })}
            maxLength={200}
          />
          <span className="hint">合言葉はこの端末の中にだけ保存し、中継サーバーに送るときだけ使います。</span>
        </label>
      )}
      <AccuracyPanel />
      {children}
      <Credits />
    </section>
  );
}

/** アプリに入れている素材のライセンス表記 */
function Credits() {
  return (
    <details className="more fold">
      <summary>
        <Scale {...ICON} />
        <span className="fold-label">素材のライセンス</span>
        <ChevronRight className="fold-chevron" {...ICON} />
      </summary>
      {/* リンクどうしが上下・左右でくっつかないよう、作品名・作者とライセンス・使い方を行に分ける */}
      <ul className="hint more-body credits">
        <li>
          <div>
            3Dのマネキン：
            <a href="https://github.com/makehumancommunity/makehuman" target="_blank" rel="noreferrer">
              MakeHuman
            </a>
            （CC0 1.0）
          </div>
        </li>
        <li>
          <div>
            靴の3Dの型：「
            <a
              href="https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MaterialsVariantsShoe"
              target="_blank"
              rel="noreferrer"
            >
              Materials Variants Shoe
            </a>
            」
          </div>
          <div>
            © 2021 Shopify（
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            ）
          </div>
          <div>ロゴを消し、形と色を変えて使っています</div>
        </li>
        <li>
          <div>
            ブーツの3Dの型：「
            <a
              href="https://sketchfab.com/3d-models/photoscanned-female-ankle-boots-81ff219398e348b79497b0ccd98316b9"
              target="_blank"
              rel="noreferrer"
            >
              Photoscanned Female Ankle Boots
            </a>
            」
          </div>
          <div>
            <a href="https://sketchfab.com/TunnelVisionStudio" target="_blank" rel="noreferrer">
              TunnelVisionStudio
            </a>
            （
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>
            ）
          </div>
          <div>面の数を減らし、色を変えて使っています</div>
        </li>
        <li>
          <div>
            服の切り抜きAI：
            <a href="https://github.com/xuebinqin/U-2-Net" target="_blank" rel="noreferrer">
              U²-Net
            </a>
            （U2-Netp、Apache-2.0）
          </div>
        </li>
      </ul>
    </details>
  );
}
