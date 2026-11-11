import { Archive, Download, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "../components/common";
import { ConfirmDialog } from "../components/ConfirmDialog";
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

/** 戻す前の確認に出す数。同じ服（同じ id）が今あれば、その数も数える */
export function restorePlan(restored: RestoredBackup, currentIds: Iterable<string>) {
  const now = new Set(currentIds);
  return {
    garments: restored.garments.length,
    overwrite: restored.garments.filter((g) => now.has(g.id)).length,
    feedback: restored.feedback.length,
    wear: restored.wear.length,
    /** 戻せるものが何も入っていない */
    empty: restored.garments.length + restored.feedback.length + restored.wear.length === 0 && !restored.profile,
  };
}

type Phase = "idle" | "exporting" | "reading" | "restoring";
const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  exporting: "書き出しています…",
  reading: "ファイルを読んでいます…",
  restoring: "戻しています…",
};

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
  const [phase, setPhase] = useState<Phase>("idle");
  /** 読み込んだが、まだ戻していないバックアップ（確認を出している間） */
  const [pending, setPending] = useState<RestoredBackup>();
  const busy = phase !== "idle" || !!pending;
  /** ブラウザが空き容量不足などで保存データを消さないよう守られているか（分からなければ undefined） */
  const [persisted, setPersisted] = useState<boolean>();

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => undefined);
  }, []);

  async function exportFile() {
    setPhase("exporting");
    setError(undefined);
    setMessage(undefined);
    try {
      setMessage(await exportBackup(data));
      onExported();
    } catch (e) {
      setError(`書き出せませんでした（${errorMessage(e)}）`);
    } finally {
      setPhase("idle");
    }
  }

  /** ファイルを読んで確かめるだけ。保存データはまだ書き換えない */
  async function readFile(file: File | undefined) {
    if (!file) return;
    setPhase("reading");
    setError(undefined);
    setMessage(undefined);
    try {
      const restored = parseBackup(await file.text());
      if (restorePlan(restored, []).empty) {
        setError("このファイルには、戻せる服や記録が入っていませんでした。何も変えていません。");
      } else {
        setPending(restored);
      }
    } catch (e) {
      setError(`${errorMessage(e)}。何も変えていません。`);
    } finally {
      setPhase("idle");
    }
  }

  async function restore(restored: RestoredBackup) {
    setPending(undefined);
    setPhase("restoring");
    try {
      await importAll(restored.garments, restored.feedback, restored.wear);
      await onImported(restored);
    } catch (e) {
      setError(`戻せませんでした（${errorMessage(e)}）`);
    } finally {
      setPhase("idle");
    }
  }

  const { garments, feedback } = data;
  return (
    <fieldset>
      <legend className="with-icon">
        <Archive {...ICON} />
        バックアップ
      </legend>
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
              void readFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {lastBackupAt && <p className="hint">前回の書き出し：{new Date(lastBackupAt).toLocaleDateString("ja-JP")}</p>}
      <p className="hint">
        戻すと、同じ服は上書きされ、今ある別の服はそのまま残ります。身長・サイズは、この端末でまだ入れていない項目だけ戻します。
      </p>
      {/* 書き出し・戻す最中と、終わったときの知らせ（読み上げにも伝わる） */}
      <p className="hint" role="status">
        {phase !== "idle" ? PHASE_TEXT[phase] : message}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pending && <RestoreConfirm restored={pending} currentIds={garments.map((g) => g.id)} onRestore={() => restore(pending)} onCancel={() => setPending(undefined)} />}
    </fieldset>
  );
}

function RestoreConfirm({
  restored,
  currentIds,
  onRestore,
  onCancel,
}: {
  restored: RestoredBackup;
  currentIds: string[];
  onRestore: () => void;
  onCancel: () => void;
}) {
  const plan = restorePlan(restored, currentIds);
  const date = new Date(restored.exportedAt).toLocaleDateString("ja-JP");
  const others = [plan.feedback && `評価${plan.feedback}件`, plan.wear && `着た記録${plan.wear}件`].filter(Boolean).join("・");
  return (
    <ConfirmDialog title="バックアップから戻しますか？" confirmLabel="戻す" confirmIcon={<Upload {...ICON} />} onConfirm={onRestore} onCancel={onCancel}>
      <p>
        <strong>
          {plan.garments}着を戻します。同じ服は上書きします。
        </strong>
      </p>
      <p className="hint">
        {date}のバックアップです。
        {plan.overwrite > 0 && `今ある服のうち${plan.overwrite}着が、バックアップの内容に置き換わります。`}
        {others && `${others}も戻します。`}
        {restored.skipped > 0 && `（${restored.skipped}着は中身が壊れているので戻せません）`}
      </p>
      <p>戻したあとで取り消すことはできません。心配なときは、先に「書き出す」で今の服を保存してください。</p>
    </ConfirmDialog>
  );
}
