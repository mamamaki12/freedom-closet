import { useCallback, useEffect, useMemo, useState } from "react";
import { createAI, type AISettings } from "./ai";
import { errorMessage } from "./components/common";
import type { Feedback, Garment } from "./domain/types";
import { AddGarments } from "./screens/AddGarments";
import { ClosetScreen } from "./screens/ClosetScreen";
import { EditGarment } from "./screens/EditGarment";
import { OutfitScreen } from "./screens/OutfitScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ShopScreen } from "./screens/ShopScreen";
import * as db from "./storage/db";
import { loadAISettings, saveAISettings } from "./storage/settings";

type Tab = "closet" | "outfit" | "shop" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "closet", label: "クローゼット" },
  { id: "outfit", label: "コーデ" },
  { id: "shop", label: "買い足し" },
  { id: "settings", label: "設定" },
];

/** タブの上にかぶせて開く画面 */
type Sheet = { kind: "add"; files?: File[] } | { kind: "edit"; garment: Garment } | null;

export function App() {
  const [tab, setTab] = useState<Tab>("closet");
  const [garments, setGarments] = useState<Garment[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  /** 「この服でコーデ」で選んだ服。変わるたびにコーデ画面を作り直す */
  const [styleWith, setStyleWith] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const [settings, setSettings] = useState<AISettings>(loadAISettings);
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
        <span className="badge">{ai.label}</span>
      </header>

      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="link" onClick={() => setNotice(undefined)}>
            閉じる
          </button>
        </div>
      )}

      <main>
        {sheet?.kind === "add" ? (
          <AddGarments
            ai={ai}
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
          <ShopScreen ai={ai} garments={garments} feedback={feedback} />
        ) : (
          <SettingsScreen
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
            onClick={() => {
              setSheet(null);
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
