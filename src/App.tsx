import { Cloud, Settings, Shirt, ShoppingBag, Smartphone, Sparkles, Undo2, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createAI, type AISettings } from "./ai";
import { errorMessage } from "./components/common";
import { ICON } from "./components/icons";
import type { BodyScan } from "./body/types";
import { shortLabel } from "./domain/colors";
import type { Profile } from "./domain/profile";
import type { Feedback, Garment, Outfit, WearRecord } from "./domain/types";
import { dayKey } from "./domain/wear";
import { requestPersistentStorage } from "./pwa";
import { AddGarments } from "./screens/AddGarments";
import { BodyScanScreen } from "./screens/BodyScanScreen";
import { ClosetScreen } from "./screens/ClosetScreen";
import { EditGarment } from "./screens/EditGarment";
import { OutfitScreen } from "./screens/OutfitScreen";
import { BackupPanel, exportBackup, restoreMessage } from "./screens/BackupPanel";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ShopScreen } from "./screens/ShopScreen";
import { lookPhotoFinder } from "./shop/lookPhotos";
import { addRecord, updateFinal } from "./storage/analysisLog";
import { mergeProfile } from "./storage/backup";
import { backupReminder, loadBackupSnooze, loadLastBackup, saveLastBackup, snoozeBackupReminder } from "./storage/backupReminder";
import * as db from "./storage/db";
import { loadBodyScan, saveBodyScan } from "./storage/bodyScan";
import { loadProfile, saveProfile } from "./storage/profile";
import { loadAISettings, saveAISettings } from "./storage/settings";

type Tab = "closet" | "outfit" | "shop" | "settings";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "closet", label: "クローゼット", icon: Shirt },
  { id: "outfit", label: "コーデ", icon: Sparkles },
  { id: "shop", label: "買い足し", icon: ShoppingBag },
  { id: "settings", label: "設定", icon: Settings },
];

/** タブの上にかぶせて開く画面 */
type Sheet = { kind: "add"; files?: File[] } | { kind: "edit"; garment: Garment } | { kind: "body-scan" } | null;

export function App() {
  const [tab, setTab] = useState<Tab>("closet");
  const [garments, setGarments] = useState<Garment[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [wears, setWears] = useState<WearRecord[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  /** 「この服でコーデ」で選んだ服。変わるたびにコーデ画面を作り直す */
  const [styleWith, setStyleWith] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  /** 体の写真から作った体型（数字だけ）。外には送らない */
  const [bodyScan, setBodyScan] = useState<BodyScan | undefined>(loadBodyScan);
  const [notice, setNotice] = useState<string>();
  /** 消した服を元に戻せるよう、少しの間だけ覚えておく */
  const [undo, setUndo] = useState<{ garment: Garment; label: string }>();
  const [lastBackupAt, setLastBackupAt] = useState(loadLastBackup);
  const [backupSnooze, setBackupSnooze] = useState(loadBackupSnooze);

  const ai = useMemo(
    () => createAI(settings, (e) => setNotice(`Claudeにつながらなかったので端末内AIで続けました（${errorMessage(e)}）`)),
    [settings],
  );

  const reload = useCallback(async () => {
    const [g, f, w] = await Promise.all([db.listGarments(), db.listFeedback(), db.listWear()]);
    setGarments(g);
    setFeedback(f);
    setWears(w);
  }, []);

  useEffect(() => {
    reload().catch((e) => setNotice(`保存データを読み込めませんでした（${errorMessage(e)}）`));
  }, [reload]);

  // 似た着こなし写真の検索にも、中継サーバーの合言葉を使う
  useEffect(() => lookPhotoFinder.setAccessCode(settings.accessCode), [settings.accessCode]);

  // 「元に戻す」は少しのあいだだけ出す
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(undefined), 15_000);
    return () => clearTimeout(t);
  }, [undo]);

  // 「元に戻す」の帯の高さぶん、右下の丸いボタンや保存のバーを上にずらす（文字が2行になっても重ならないように）
  const undoBarRef = useRef<HTMLDivElement>(null);
  const [undoLift, setUndoLift] = useState(0);
  useLayoutEffect(() => {
    const el = undoBarRef.current;
    if (!undo || !el) return setUndoLift(0);
    const measure = () => setUndoLift(Math.ceil(el.getBoundingClientRect().height) + 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [undo]);

  const backupData = { garments, feedback, wears, profile };
  const reminder = backupReminder(garments, lastBackupAt, backupSnooze);
  const markBackedUp = (at = Date.now()) => setLastBackupAt(saveLastBackup(at));
  const backupNow = async () => {
    try {
      setNotice(await exportBackup(backupData));
      markBackedUp();
    } catch (e) {
      setNotice(`書き出せませんでした（${errorMessage(e)}）`);
    }
  };

  // 「今日はこれ」。1日1件で、同じ日にもう一度押したら上書き、null なら取り消し
  const wearToday = async (o: Outfit | null) => {
    const day = dayKey(new Date());
    if (o) await db.saveWear({ day, garmentIds: o.garmentIds, outfitKey: o.key, at: Date.now() });
    else await db.deleteWear(day);
    await reload();
  };

  return (
    <div className="app" style={undoLift ? ({ "--undo-lift": `${undoLift}px` } as CSSProperties) : undefined}>
      <header className="top">
        <h1>freedom closet</h1>
        <span className="badge with-icon">
          {ai.id === "claude" ? <Cloud size={14} aria-hidden /> : <Smartphone size={14} aria-hidden />}
          {ai.label}
        </span>
      </header>

      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="icon-btn" onClick={() => setNotice(undefined)} aria-label="閉じる" title="閉じる">
            <X {...ICON} />
          </button>
        </div>
      )}
      <main>
        {sheet?.kind === "add" ? (
          <AddGarments
            ai={ai}
            profile={profile}
            initialFiles={sheet.files}
            onSave={async (g, analysis) => {
              await db.saveGarment(g);
              // 服が入ったら、ブラウザに長期保存をもう一度お願いする（使い始めてからのほうが認められやすい）
              void requestPersistentStorage();
              if (analysis) {
                // 判定の記録（検証用）。記録に失敗しても登録は続ける
                await addRecord({
                  id: g.id,
                  at: Date.now(),
                  provider: ai.id,
                  elapsedMs: analysis.elapsedMs,
                  predicted: {
                    category: analysis.result.category,
                    subType: analysis.result.subType,
                    color: analysis.result.color,
                    confidence: analysis.result.confidence,
                  },
                  final: { category: g.category, subType: g.subType, color: g.color },
                }).catch(() => undefined);
              }
              await reload();
            }}
            onEdit={(garment) => setSheet({ kind: "edit", garment })}
            onDone={(saved) => {
              setSheet(null);
              setTab("closet");
              if (saved > 0) setNotice(`${saved}着を登録しました`);
            }}
          />
        ) : sheet?.kind === "edit" ? (
          <EditGarment
            key={sheet.garment.id}
            garment={sheet.garment}
            wears={wears}
            onClose={() => setSheet(null)}
            onSave={async (g) => {
              await db.saveGarment(g);
              // 直した値を判定の記録に反映する（検証用）
              await updateFinal(g.id, { category: g.category, subType: g.subType, color: g.color }).catch(() => undefined);
              await reload();
              setSheet(null);
            }}
            onDelete={async () => {
              const deleted = sheet.garment;
              await db.deleteGarment(deleted.id);
              await reload();
              setSheet(null);
              setUndo({ garment: deleted, label: shortLabel(deleted) });
            }}
            onStyle={() => {
              setStyleWith((cur) => ({ ids: [sheet.garment.id], n: cur.n + 1 }));
              setSheet(null);
              setTab("outfit");
            }}
          />
        ) : sheet?.kind === "body-scan" ? (
          <BodyScanScreen
            profile={profile}
            onClose={() => setSheet(null)}
            onSave={(scan) => {
              setBodyScan(scan);
              saveBodyScan(scan);
              setSheet(null);
            }}
          />
        ) : tab === "closet" ? (
          <ClosetScreen
            garments={garments}
            wears={wears}
            onAdd={(files) => setSheet({ kind: "add", files })}
            onEdit={(garment) => setSheet({ kind: "edit", garment })}
            setupNote={ai.setupNote?.()}
            backupReminder={reminder}
            onBackupNow={backupNow}
            onSnoozeBackup={() => setBackupSnooze(snoozeBackupReminder())}
          />
        ) : tab === "outfit" ? (
          <OutfitScreen
            key={styleWith.n}
            ai={ai}
            profile={profile}
            bodyScan={bodyScan}
            initialMustInclude={styleWith.ids}
            onGoCloset={() => setTab("closet")}
            garments={garments}
            feedback={feedback}
            wears={wears}
            onWear={wearToday}
            onFeedback={async (f) => {
              const current = feedback.find((x) => x.outfitKey === f.outfitKey);
              // 同じ評価をもう一度押したら取り消す
              if (current && current.liked === f.liked) await db.deleteFeedback(f.outfitKey);
              else await db.saveFeedback(f);
              await reload();
            }}
          />
        ) : tab === "shop" ? (
          <ShopScreen ai={ai} garments={garments} feedback={feedback} profile={profile} onGoSettings={() => setTab("settings")} />
        ) : (
          <SettingsScreen
            profile={profile}
            bodyScan={bodyScan}
            onScanBody={() => setSheet({ kind: "body-scan" })}
            onDeleteBodyScan={() => {
              setBodyScan(undefined);
              saveBodyScan(undefined);
            }}
            onProfileChange={(p) => {
              setProfile(p);
              saveProfile(p);
            }}
            settings={settings}
            onChange={(s) => {
              setSettings(s);
              saveAISettings(s);
            }}
          >
            <BackupPanel
              data={backupData}
              lastBackupAt={lastBackupAt}
              onExported={() => markBackedUp()}
              onImported={async (restored) => {
                await reload();
                const merged = mergeProfile(profile, restored.profile);
                setProfile(merged);
                saveProfile(merged);
                markBackedUp(restored.exportedAt);
                // 戻した服をすぐ見られるよう、クローゼットに移って知らせる
                setNotice(restoreMessage(restored));
                setTab("closet");
              }}
            />
          </SettingsScreen>
        )}
      </main>

      {/* 消したあとの「元に戻す」。下のタブのすぐ上に出す（読み上げには下の文で伝える） */}
      <p className="sr-only" role="status">
        {undo ? `「${undo.label}」を削除しました。画面の下の「元に戻す」で戻せます。` : ""}
      </p>
      {undo && (
        <div className="undo-bar" ref={undoBarRef}>
          <span className="grow">「{undo.label}」を削除</span>
          <button
            className="btn small"
            title="元に戻す"
            onClick={async () => {
              const { garment } = undo;
              setUndo(undefined);
              try {
                await db.saveGarment(garment);
                await reload();
              } catch (e) {
                setNotice(`元に戻せませんでした（${errorMessage(e)}）`);
              }
            }}
          >
            <Undo2 {...ICON} />
            元に戻す
          </button>
          <button className="icon-btn" onClick={() => setUndo(undefined)} aria-label="閉じる" title="閉じる">
            <X {...ICON} />
          </button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id && !sheet ? "on" : ""}
            aria-current={tab === t.id && !sheet ? "page" : undefined}
            onClick={() => {
              setSheet(null);
              setTab(t.id);
            }}
          >
            <t.icon size={24} strokeWidth={tab === t.id && !sheet ? 2.2 : 1.8} aria-hidden />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
