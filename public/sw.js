// オフラインでも開けるようにするための Service Worker。
// - 画面（HTML）：まず通信して、だめなら保存しておいたものを使う
// - ビルドされたファイル（/assets/ は名前に版が入る）：保存しておいたものを先に使う
// 判定モデルは Transformers.js が自分で保存するので、ここでは扱わない。
// GitHub Pages では、同じユーザーのほかのアプリとオリジン（<ユーザー名>.github.io）が同じで、保存場所（Cache Storage）も共通。
// 消すのはこのアプリが作った古い保存（名前が freedom-closet- で始まるもの）だけにする。
const PREFIX = "freedom-closet-";
const CACHE = `${PREFIX}v1`;
const SHELL = ["./", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 別のサイト（天気・モデル配信・Claude中継など）と POST はそのまま通す
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 404 などのページを、通信がないときに開く画面として残さない
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./", copy));
          }
          return res;
        })
        .catch(() => caches.match("./", { cacheName: CACHE })),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.includes("/assets/")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
