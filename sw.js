/* sw.js — 오프라인 캐싱.
   앱 껍데기는 설치할 때 미리 받아두고, 이후엔 캐시부터 보여주면서
   뒤로 조용히 갱신한다. 배포할 때 VERSION만 올리면 새 캐시로 갈아탄다. */

var VERSION = "v1";
var CACHE = "moneyplan-" + VERSION;

/* 이게 없으면 앱이 안 열리는 것들 */
var SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/calc.js",
  "./js/store.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 하나라도 실패하면 설치가 통째로 실패하므로 개별로 담는다
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k); // 지난 버전 정리
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function cachePut(request, response) {
  if (!response || !response.ok) return response;
  var copy = response.clone();
  caches.open(CACHE).then(function (cache) {
    cache.put(request, copy);
  });
  return response;
}

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // 페이지 이동: 네트워크 먼저 (새 버전을 빨리 받도록), 끊기면 캐시
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req)
        .then(function (res) {
          return cachePut(req, res);
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("./index.html") || caches.match("./");
          });
        })
    );
    return;
  }

  // 그 외: 캐시 먼저 보여주고 뒤에서 갱신 (폰트 CDN 포함)
  ev.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req)
        .then(function (res) {
          return cachePut(req, res);
        })
        .catch(function () {
          return hit;
        });
      return hit || network;
    })
  );
});
