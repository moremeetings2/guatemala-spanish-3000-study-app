const CACHE_NAME = "hablavos-v28";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./api.js",
  "./ai.js",
  "./app.js",
  "./manifest.webmanifest",
  "./data/guatemala_spanish_study_pack.json",
  "./data/reading-data.json",
  "./data/synonyms.json",
  "./data/sentences.json",
];
const APP_ASSET_URLS = new Set(
  APP_ASSETS.map((assetPath) => new URL(assetPath, self.location.href).href)
);
const OFFLINE_FALLBACK_URL = new URL("./index.html", self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // GitHub Pages serves assets with max-age=600, so a plain fetch here can
      // seed the new cache with copies up to 10 minutes stale — users then see
      // the previous deploy even after the SW updates. `no-cache` forces
      // revalidation with the server (cheap 304 when unchanged).
      .then((cache) => cache.addAll(APP_ASSETS.map((url) => new Request(url, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Never touch cross-origin requests — the on-device AI pulls its WASM from a
  // CDN and multi-hundred-MB model files from Hugging Face (cached in OPFS by
  // wllama itself). Let the browser handle those natively.
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, OFFLINE_FALLBACK_URL));
    return;
  }

  if (requestUrl.origin === self.location.origin && APP_ASSET_URLS.has(requestUrl.href)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request, fallbackUrl = null) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // "Network-first" must actually reach the server. A plain fetch(request)
    // consults the browser's HTTP cache, and GitHub Pages marks assets
    // cacheable for 10 minutes (max-age=600) — so right after a deploy users
    // kept getting the previous app.js even on refresh. `no-cache` forces
    // revalidation (304 when unchanged, fresh body when a deploy changed it).
    // Fetch by URL because navigation Requests can't be re-constructed.
    const response = await fetch(request.url, { cache: "no-cache" });
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
