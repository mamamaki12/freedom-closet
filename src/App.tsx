import { Cloud, Settings, Shirt, ShoppingBag, Smartphone, Sparkles, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createAI, type AISettings } from "./ai";
import { errorMessage } from "./components/common";
import { ICON } from "./components/icons";
import type { BodyScan } from "./body/types";
import type { Profile } from "./domain/profile";
import type { Feedback, Garment } from "./domain/types";
import { AddGarments } from "./screens/AddGarments";
import { BodyScanScreen } from "./screens/BodyScanScreen";
import { ClosetScreen } from "./screens/ClosetScreen";
import { EditGarment } from "./screens/EditGarment";
import { OutfitScreen } from "./screens/OutfitScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ShopScreen } from "./screens/ShopScreen";
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
  const [sheet, setSheet] = useState<Sheet>(null);
  /** 「この服でコーデ」で選んだ服。変わるたびにコーデ画面を作り直す */
  const [styleWith, setStyleWith] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  /** 体の写真から作った体型（数字だけ）。外には送らない */
  const [bodyScan, setBodyScan] = useState<BodyScan | undefined>(loadBodyScan);
  const [notice, setNotice] = useState<string>();

  const ai = useMemo(
    () => createAI(settings, (e) => setNotice(`Claudeにつながらなかったので端末内AIで続けました（${errorMessage(e)}）`)),
    [settings],
  );

  const reload = useCallback(async () => {
    const [g, f] = await Promise.all([db.listGarments(), db.listFeedback()]);
    setGarments(g);
    setFeedback(f);
  }, []);

  useEffect(() => {
    reload().catch((e) => setNotice(`保存データを読み込めませんでした（${errorMessage(e)}）`));
  }, [reload]);

  return (
    <div className="app">
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
            onSave={async (g) => {
              await db.saveGarment(g);
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
            onClose={() => setSheet(null)}
            onSave={async (g) => {
              await db.saveGarment(g);
              await reload();
              setSheet(null);
            }}
            onDelete={async () => {
              await db.deleteGarment(sheet.garment.id);
              await reload();
              setSheet(null);
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
            onAdd={(files) => setSheet({ kind: "add", files })}
            onEdit={(garment) => setSheet({ kind: "edit", garment })}
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
          />
        )}
      </main>

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
