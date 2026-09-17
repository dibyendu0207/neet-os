/* =========================================================
   NEET OS — Service Worker
   Stable PWA + Safe Caching
   ========================================================= */

const CACHE_NAME = "neet-os-v3";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./firebase-sync.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];


/* =========================================================
   INSTALL
   ========================================================= */

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );

});


/* =========================================================
   ACTIVATE
   ========================================================= */

self.addEventListener("activate", event => {

    event.waitUntil(
        caches.keys()
            .then(keys =>
                Promise.all(
                    keys
                        .filter(key => key !== CACHE_NAME)
                        .map(key => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );

});


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);


    /* -----------------------------------------------------
       FIREBASE / GOOGLE SERVICES
       Never intercept these requests.
    ----------------------------------------------------- */

    if (
        url.hostname.includes("firebaseio.com") ||
        url.hostname.includes("firebaseapp.com") ||
        url.hostname.includes("googleapis.com") ||
        url.hostname.includes("gstatic.com") ||
        url.hostname.includes("google.com") ||
        url.hostname.includes("identitytoolkit.googleapis.com")
    ) {
        return;
    }


    /* -----------------------------------------------------
       FIREBASE SYNC BRIDGE

       Network first.
       If network fails, use cached copy.

       NEVER return index.html for this JS request.
    ----------------------------------------------------- */

    if (
        url.pathname.endsWith("/firebase-sync.js") ||
        url.pathname.endsWith("firebase-sync.js")
    ) {

        event.respondWith(

            fetch(request, { cache: "no-store" })

                .then(response => {

                    if (response && response.ok) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache =>
                                cache.put(request, copy)
                            )
                            .catch(() => {});

                    }

                    return response;

                })

                .catch(() =>
                    caches.match(request)
                )

        );

        return;
    }


    /* =====================================================
       JAVASCRIPT
       ===================================================== */

    if (
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".mjs")
    ) {

        event.respondWith(

            fetch(request, { cache: "no-store" })

                .then(response => {

                    if (response && response.ok) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache =>
                                cache.put(request, copy)
                            )
                            .catch(() => {});

                    }

                    return response;

                })

                .catch(() =>
                    caches.match(request)
                )

        );

        return;
    }


    /* =====================================================
       CSS
       ===================================================== */

    if (url.pathname.endsWith(".css")) {

        event.respondWith(

            fetch(request, { cache: "no-store" })

                .then(response => {

                    if (response && response.ok) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache =>
                                cache.put(request, copy)
                            )
                            .catch(() => {});

                    }

                    return response;

                })

                .catch(() =>
                    caches.match(request)
                )

        );

        return;
    }


    /* =====================================================
       HTML / NAVIGATION
       ===================================================== */

    if (
        request.mode === "navigate" ||
        url.pathname.endsWith(".html") ||
        url.pathname === "/"
    ) {

        event.respondWith(

            fetch(request, { cache: "no-store" })

                .then(response => {

                    if (response && response.ok) {

                        const copy = response.clone();

                        caches.open(CACHE_NAME)
                            .then(cache =>
                                cache.put(request, copy)
                            )
                            .catch(() => {});

                    }

                    return response;

                })

                .catch(() =>
                    caches.match("./index.html")
                )

        );

        return;
    }


    /* =====================================================
       IMAGES / MANIFEST
       ===================================================== */

    if (
        url.pathname.endsWith(".png") ||
        url.pathname.endsWith(".jpg") ||
        url.pathname.endsWith(".jpeg") ||
        url.pathname.endsWith(".webp") ||
        url.pathname.endsWith(".svg") ||
        url.pathname.endsWith(".ico") ||
        url.pathname.endsWith(".json")
    ) {

        event.respondWith(

            caches.match(request)

                .then(cached => {

                    if (cached) {
                        return cached;
                    }

                    return fetch(request)
                        .then(response => {

                            if (response && response.ok) {

                                const copy =
                                    response.clone();

                                caches.open(CACHE_NAME)
                                    .then(cache =>
                                        cache.put(request, copy)
                                    )
                                    .catch(() => {});

                            }

                            return response;

                        });

                })

        );

        return;
    }


    /* =====================================================
       EVERYTHING ELSE
       ===================================================== */

    event.respondWith(

        fetch(request)
            .catch(() =>
                caches.match(request)
            )

    );

});


/* =========================================================
   NOTIFICATION CLICK
   ========================================================= */

self.addEventListener(
    "notificationclick",
    event => {

        event.notification.close();

        const target =
            event.notification.data?.url ||
            "./index.html";

        event.waitUntil(

            clients.matchAll({
                type: "window",
                includeUncontrolled: true
            })

                .then(list => {

                    for (const client of list) {

                        if ("focus" in client) {

                            if (client.navigate) {
                                client.navigate(target);
                            }

                            return client.focus();
                        }
                    }

                    return clients.openWindow(target);

                })

        );

    }
);
