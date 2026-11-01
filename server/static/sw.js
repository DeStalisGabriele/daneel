// Service worker di Daneel: riceve le notifiche push e, toccandole, apre l'app sulla chat giusta.
// Non mette niente in cache: l'app si carica sempre fresca dal server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {testo: e.data && e.data.text()}; }
  const agente = d.agente || "daneel";
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.titolo || "", {   // senza titolo: icona e nome dell'app, poi il messaggio
      body: d.testo || "", icon: "icona-192.png", badge: "icona-192.png",
      tag: "daneel-" + agente, data: {agente},
    }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
  ]));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = "./?agente=" + encodeURIComponent((e.notification.data || {}).agente || "daneel");
  e.waitUntil((async () => {
    const aperte = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    for (const c of aperte) {
      c.postMessage({tipo: "apri", agente: (e.notification.data || {}).agente});
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});
