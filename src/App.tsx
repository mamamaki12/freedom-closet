import { useCallback, useEffect, useMemo, useState } from "react";
import { createAI, type AISettings } from "./ai";
import { errorMessage } from "./components/common";
import type { Feedback, Garment } from "./domain/types";
import { ClosetScreen } from "./screens/ClosetScreen";
import { GarmentForm } from "./screens/GarmentForm";
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

export function App() {
  const [tab, setTab] = useState<Tab>("closet");
  const [garments, setGarments] = useState<Garment[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [editing, setEditing] = useState<Garment | "new" | null>(null);
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
        {editing ? (
          <GarmentForm
            key={editing === "new" ? "new" : editing.id}
            ai={ai}
            initial={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSave={async (g) => {
              await db.saveGarment(g);
              await reload();
              setEditing(null);
            }}
            onDelete={
              editing === "new"
                ? undefined
                : async () => {
                    await db.deleteGarment(editing.id);
                    await reload();
                    setEditing(null);
                  }
            }
          />
        ) : tab === "closet" ? (
          <ClosetScreen garments={garments} onAdd={() => setEditing("new")} onEdit={setEditing} />
        ) : tab === "outfit" ? (
          <OutfitScreen
            ai={ai}
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
            className={tab === t.id && !editing ? "on" : ""}
            onClick={() => {
              setEditing(null);
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
