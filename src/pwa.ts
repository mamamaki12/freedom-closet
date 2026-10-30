// ホーム画面に追加して使うための準備。

/** 本番ビルドのときだけ Service Worker を登録する（開発中は古い画面が残って紛らわしいため） */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // 登録できなくてもアプリは使える
    });
  });
}

/**
 * 保存した服の写真がブラウザに勝手に消されないよう、長期保存をお願いする。
 * Safari はしばらく開かないサイトのデータを消すことがあるため、ホーム画面に追加して使うのがおすすめ。
 */
export async function requestPersistentStorage(): Promise<boolean | undefined> {
  try {
    if (!navigator.storage?.persist) return undefined;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}

/** ホーム画面から開いているか */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
