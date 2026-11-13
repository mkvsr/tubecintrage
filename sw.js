// Service worker : l'application reste utilisable hors connexion (atelier, tablettes).
// Réseau d'abord (les mises à jour arrivent tout de suite), copie locale si pas de réseau.
const CACHE = "tubecintrage-v0.6.27";
const FICHIERS = [
  "./", "index.html", "css/app.css", "manifest.webmanifest", "img/icone.svg", "img/schema_zero.svg",
  "js/app.js", "js/vue3d.js", "js/modele_mg030.js", "js/pdf.js", "js/qrcode.js", "js/stockage.js", "js/dialogues.js",
  "js/core/vec.js", "js/core/geometrie.js", "js/core/parametres.js", "js/core/sequence.js", "js/core/simulation.js",
  "js/core/importation.js", "js/core/debit.js", "js/core/step.js", "js/core/gueule.js", "js/atelier.js",
  "img/icone-192.png", "img/icone-512.png",
  "vendor/three/three.module.min.js", "vendor/three/addons/OrbitControls.js", "vendor/jspdf.umd.min.js",
  "vendor/occt-import-js.js", "vendor/occt-import-js.wasm", "vendor/fonts/DejaVuSans.ttf", "vendor/fonts/DejaVuSans-Bold.ttf",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin || req.url.includes("/api/")) return;
  // cache: "no-cache" : revalide chaque fichier auprès du serveur. Sinon le navigateur garde jusqu'à 10 min
  // (cache GitHub Pages) d'anciens css/js à côté d'un index.html récent, et mélange deux versions.
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error()))
  );
});
