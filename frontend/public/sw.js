/* TaskMaster service worker — Web Push */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "TaskMaster", body: "", url: "/", tag: "taskmaster" };
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {
    try {
      data.body = event.data ? event.data.text() : "";
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "TaskMaster", {
      body: data.body || "",
      tag: data.tag || "taskmaster",
      data: { url: data.url || "/" },
      vibrate: [120, 60, 120],
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(absolute);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute);
      }
    })
  );
});
