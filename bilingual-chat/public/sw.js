/* Service worker : notifications push + page hors-ligne. */
const OFFLINE_CACHE = "offline-v2"; // à incrémenter quand offline.html change
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Supprime les anciennes versions de la page hors-ligne
      for (const key of await caches.keys()) if (key !== OFFLINE_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Navigation sans réseau → page "Vous êtes hors ligne" au lieu de l'écran d'erreur du navigateur.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// Safari (iPhone/Mac) exige qu'une notification soit affichée pour CHAQUE push reçu.
const IS_APPLE = /iPhone|iPad|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android/.test(self.navigator.userAgent);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const url = data.url || "/dashboard";
  const isJoin = data.kind === "join";

  event.waitUntil(
    (async () => {
      // La personne regarde déjà cette conversation : l'app joue son propre carillon,
      // inutile d'ajouter une notification (sauf sur Safari, qui l'impose — elle sera alors silencieuse).
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const viewing = windows.some(
        (w) => w.focused && w.visibilityState === "visible" && new URL(w.url).pathname === url,
      );
      if (viewing && !IS_APPLE) return;

      await self.registration.showNotification(data.title || "Nouveau message", {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag, // une notification par conversation (les suivantes la remplacent)…
        renotify: Boolean(data.tag), // …mais chaque nouveau message sonne et vibre à nouveau
        silent: viewing, // son et vibration du téléphone, sauf si l'écran affiche déjà la conversation
        vibrate: isJoin ? [300, 120, 300, 120, 300] : [200, 100, 200],
        requireInteraction: isJoin, // "Nouvelle conversation" reste affichée jusqu'à ce qu'on la touche
        timestamp: Date.now(),
        lang: data.lang,
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((w) => w.url === url) || windows[0];
      if (existing) {
        await existing.focus();
        if (existing.url !== url && "navigate" in existing) await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
