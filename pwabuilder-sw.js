const CACHE_STATIC = "fintrack-static-v3";
const CACHE_DYNAMIC = "fintrack-dynamic-v2";

// Arquivos essenciais (app shell)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline.html"
];

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(self.location.hostname);

// 🔹 INSTALAÇÃO (cache inicial)
self.addEventListener("install", (event) => {
  if (IS_LOCAL) {
    self.skipWaiting();
    return;
  }

  self.skipWaiting(); // ativa imediatamente

  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// 🔹 ATIVAÇÃO (limpa caches antigos)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (
            key !== CACHE_STATIC &&
            key !== CACHE_DYNAMIC
          ) {
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// 🔹 FETCH (estratégia inteligente)
self.addEventListener("fetch", (event) => {
  if (IS_LOCAL) return;

  const req = event.request;

  // 🔸 HTML → Network first (sempre atualizado)
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          return caches.open(CACHE_DYNAMIC).then((cache) => {
            cache.put(req, res.clone());
            return res;
          });
        })
        .catch(() =>
          caches.match(req).then((res) => {
            return res || caches.match("/offline.html");
          })
        )
    );
    return;
  }

  // 🔸 Outros (CSS, JS, imagens) → Cache first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        return caches.open(CACHE_DYNAMIC).then((cache) => {
          cache.put(req, res.clone());
          return res;
        });
      });
    })
  );
});
