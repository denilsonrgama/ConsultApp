const CACHE_NAME = "consultapp-v258";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/styles/app.css",
  "./src/data/seed.js",
  "./src/app.js",
  "./assets/consult-icon.png",
  "./assets/consult-icon-192.png",
  "./assets/consult-icon-512.png",
  "./assets/fundo-formulario.png",
  "./assets/logo-cadastro-clientes.bmp",
  "./assets/logo-cadastro-orcamentos.bmp",
  "./assets/logo-servicos.bmp",
  "./assets/banner-dashboard.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
