const CACHE_STATIC = "fintrack-static-v2";
const CACHE_DYNAMIC = "fintrack-dynamic-v1";

// Arquivos essenciais (app shell)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline.html"
];

// 🔹 INSTALAÇÃO (cache inicial)
self.addEventListener("install", (event) => {
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