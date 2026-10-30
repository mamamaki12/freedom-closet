import { useState } from "react";
import { errorMessage } from "../components/common";
import type { Feedback, Garment } from "../domain/types";
import { backupFileName, createBackup, parseBackup } from "../storage/backup";
import { importAll } from "../storage/db";

export function BackupPanel({
  garments,
  feedback,
  onImported,
}: {
  garments: Garment[];
  feedback: Feedback[];
  onImported: () => Promise<void>;
}) {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function exportFile() {
    setBusy(true);
    setError(undefined);
    try {
      const backup = await createBackup(garments, feedback);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage(`${garments.length}着と評価${feedback.length}件を書き出しました。`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const data = parseBackup(await file.text());
      await importAll(data.garments, data.feedback);
      await onImported();
      setMessage(
        `${new Date(data.exportedAt).toLocaleDateString("ja-JP")}のバックアップから${data.garments.length}着と評価${data.feedback.length}件を戻しました。`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend>バックアップ</legend>
      <p className="hint">
        服の写真と評価は、この端末のブラウザの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどきファイルに書き出してください。
      </p>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={exportFile} disabled={busy || (garments.length === 0 && feedback.length === 0)}>
          書き出す
        </button>
        <label className={`btn${busy ? " disabled" : ""}`}>
          ファイルから戻す
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy}
            onChange={(e) => {
              importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="hint">戻すと、同じ服は上書きされ、今ある別の服はそのまま残ります。</p>
      {message && <p className="hint" role="status">{message}</p>}
      {error && <p className="error">{error}</p>}
    </fieldset>
  );
}
