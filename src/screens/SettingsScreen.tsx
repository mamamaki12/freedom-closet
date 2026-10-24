import type { AISettings } from "../ai";
import type { ReactNode } from "react";

export function SettingsScreen({
  settings,
  onChange,
  children,
}: {
  settings: AISettings;
  onChange: (s: AISettings) => void;
  /** 設定画面の下に足すパネル（バックアップなど） */
  children?: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>設定</h2>
      <fieldset>
        <legend>使うAI</legend>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === "local"}
            onChange={() => onChange({ ...settings, provider: "local" })}
          />
          <span>
            <strong>端末内AI</strong>
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
            <strong>Claude API</strong>
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
      {children}
    </section>
  );
}
