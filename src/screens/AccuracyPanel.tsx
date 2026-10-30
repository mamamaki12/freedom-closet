// 検証用：自動判定がどれくらい合っていたかを見る
import { useEffect, useState } from "react";
import { errorMessage } from "../components/common";
import { clearRecords, listRecords, summarize, toCsv, type AnalysisRecord } from "../storage/analysisLog";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function AccuracyPanel() {
  const [records, setRecords] = useState<AnalysisRecord[]>();
  const [error, setError] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    listRecords()
      .then(setRecords)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  function download() {
    if (!records) return;
    // Excelで文字化けしないよう先頭にBOMを付ける
    const url = URL.createObjectURL(new Blob(["﻿", toCsv(records)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `freedom-closet-判定記録-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <fieldset>
      <legend>自動判定の記録（検証用）</legend>
      <p className="hint">
        服を登録するたびに、AIの判定と、本人が直したあとの値を記録しています（写真は残しません）。直さなかったものは「合っていた」と数えます。
      </p>
      {error && <p className="error">{error}</p>}
      {records && records.length === 0 && <p className="hint">まだ記録がありません。</p>}
      {records && records.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>AI</th>
              <th>件数</th>
              <th>種類</th>
              <th>名前</th>
              <th>色</th>
              <th>時間（中央値）</th>
            </tr>
          </thead>
          <tbody>
            {summarize(records).map((s) => (
              <tr key={s.provider}>
                <td>{s.provider === "local" ? "端末内" : "Claude"}</td>
                <td>
                  {s.total}
                  {s.failed > 0 && `（失敗${s.failed}）`}
                </td>
                <td>{pct(s.categoryRate)}</td>
                <td>{pct(s.subTypeRate)}</td>
                <td>{pct(s.colorRate)}</td>
                <td>{(s.medianMs / 1000).toFixed(1)}秒</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={download} disabled={!records?.length}>
          CSVで書き出す
        </button>
        <button
          className="btn danger"
          disabled={!records?.length}
          onClick={async () => {
            if (!confirmClear) return setConfirmClear(true);
            await clearRecords();
            setRecords([]);
            setConfirmClear(false);
          }}
        >
          {confirmClear ? "もう一度押すと消去" : "記録を消す"}
        </button>
      </div>
    </fieldset>
  );
}
