import { Download, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "../components/common";
import { BtnText, ICON } from "../components/icons";
import type { Profile } from "../domain/profile";
import type { Feedback, Garment, WearRecord } from "../domain/types";
import { backupFileName, createBackup, parseBackup, type RestoredBackup } from "../storage/backup";
import { importAll } from "../storage/db";

export interface BackupData {
  garments: Garment[];
  feedback: Feedback[];
  wears: WearRecord[];
  profile: Profile;
}

/** バックアップのファイルを作って保存する（設定画面と、クローゼットのお知らせから使う）。終わったら知らせる文を返す */
export async function exportBackup(data: BackupData): Promise<string> {
  const backup = await createBackup({ garments: data.garments, feedback: data.feedback, wear: data.wears, profile: data.profile });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `服${data.garments.length}着と、評価・着た記録・サイズの設定を書き出しました。`;
}

/** 戻したあとに知らせる文 */
export function restoreMessage(restored: RestoredBackup): string {
  return (
    `${new Date(restored.exportedAt).toLocaleDateString("ja-JP")}のバックアップから${restored.garments.length}着と評価${restored.feedback.length}件を戻しました。` +
    (restored.skipped ? `（${restored.skipped}着は中身が壊れていたので戻せませんでした）` : "")
  );
}

export function BackupPanel({
  data,
  lastBackupAt,
  onExported,
  onImported,
}: {
  data: BackupData;
  /** 前に書き出した時刻 */
  lastBackupAt?: number;
  onExported: () => void;
  /** 戻したあと（保存は済んでいる）。画面の読み直し・身長やサイズの反映・知らせる文を出すのは呼ぶ側 */
  onImported: (restored: RestoredBackup) => Promise<void>;
}) {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** ブラウザが空き容量不足などで保存データを消さないよう守られているか（分からなければ undefined） */
  const [persisted, setPersisted] = useState<boolean>();

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => undefined);
  }, []);

  async function exportFile() {
    setBusy(true);
    setError(undefined);
    try {
      setMessage(await exportBackup(data));
      onExported();
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
      const restored = parseBackup(await file.text());
      await importAll(restored.garments, restored.feedback, restored.wear);
      await onImported(restored);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const { garments, feedback } = data;
  return (
    <fieldset>
      <legend>バックアップ</legend>
      <p className="hint">
        服の写真と評価は、この端末のブラウザの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどきファイルに書き出してください。
      </p>
      {persisted === false && (
        <p className="hint">
          この端末では、空き容量が少ないときなどに、ブラウザが保存データを消すことがあります。ホーム画面に追加して使うと消されにくくなります。
        </p>
      )}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button
          className="btn"
          onClick={exportFile}
          disabled={busy || (garments.length === 0 && feedback.length === 0)}
          title="バックアップを書き出す"
        >
          <Download {...ICON} />
          書き出す
        </button>
        <label className={`btn${busy ? " disabled" : ""}`} title="ファイルから戻す">
          <Upload {...ICON} />
          <BtnText text="ファイルから戻す" short="戻す" />
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
      {lastBackupAt && <p className="hint">前回の書き出し：{new Date(lastBackupAt).toLocaleDateString("ja-JP")}</p>}
      <p className="hint">
        戻すと、同じ服は上書きされ、今ある別の服はそのまま残ります。身長・サイズは、この端末でまだ入れていない項目だけ戻します。
      </p>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </fieldset>
  );
}
