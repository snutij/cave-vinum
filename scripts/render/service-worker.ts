// Offline support: try the network first, then fall back to the cache.
// Each cave has its own cache and only handles files in its own folder, so one
// cave's worker never serves another cave's page.
export const serviceWorker = (
  slug: string,
): string => `const CACHE = ${JSON.stringify(`cave-vinum-${slug}`)};
const BASE = new URL("./", self.location).pathname;
// Own files only: the folder itself or a file directly in it (never a sub-folder such as another cave).
const own = (u) => {
  if (u.origin !== location.origin || !u.pathname.startsWith(BASE)) return false;
  const rest = u.pathname.slice(BASE.length);
  return rest === "" || (!rest.includes("/") && rest.includes("."));
};
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !own(new URL(e.request.url))) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then((c) => c.match(e.request).then((r) => r || c.match("./")))));
});
`;

// Static-host headers: prevent search engine indexing.
export const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
`;

/** Replaces the worker that older versions registered at the site root, then removes itself. */
export const ROOT_SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.delete("cave-vinum").then(() => self.registration.unregister())));
`;
