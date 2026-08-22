/* sw.js — 오프라인 지원 + 배포 즉시 반영.

   원칙
   - 내 서버 파일(HTML/CSS/JS)은 "네트워크 먼저". 온라인이면 항상 최신을 본다.
     느리거나 끊기면 캐시로 넘어가므로 오프라인에서도 열린다.
   - 폰트·SDK 같은 외부 파일은 "캐시 먼저, 뒤에서 갱신". 잘 안 바뀌고 무겁다.
   - Firebase 통신은 아예 건드리지 않는다. 캐시된 응답을 주면 로그인·동기화가 깨진다.

   배포할 때 VERSION만 올리면 된다. 새 워커가 설치되면 앱이 알려주고,
   당겨서 새로고침하면 바로 갈아탄다. */

var VERSION = "v6";
var CACHE = "moneyplan-" + VERSION;
var NET_TIMEOUT = 4000; // 이 시간 안에 응답이 없으면 캐시부터 보여준다

/* 이게 없으면 앱이 안 열리는 것들 */
var SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/calc.js",
  "./js/model.js",
  "./js/firebase-config.js",
  "./js/auth.js",
  "./js/store.js",
  "./js/refresh.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./icons/favicon-32.png"
];

/* 처음 설치할 때 같이 받아 두면 비행기 모드에서도 앱이 뜬다 */
var VENDOR = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"
];

/* 절대 가로채면 안 되는 곳: 로그인 토큰과 실시간 동기화가 오간다 */
var BYPASS_HOSTS = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaselogging.googleapis.com",
  "firebaseremoteconfig.googleapis.com",
  "www.googleapis.com",
  "firebasestorage.googleapis.com"
];

self.addEventListener("install", function (ev) {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        // 하나라도 실패하면 설치가 통째로 실패하므로 개별로 담는다
        return Promise.all(
          SHELL.concat(VENDOR).map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
          })
        );
      })
      .catch(function () {})
      .then(function () {
        // 곧바로 대기 상태로 간다. 실제 교체는 앱이 SKIP_WAITING을 보낼 때.
        return undefined;
      })
  );
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            // 이 앱이 만든 지난 버전 캐시만 지운다
            if (k !== CACHE && k.indexOf("moneyplan-") === 0) return caches.delete(k);
            return undefined;
          })
        );
      })
      .catch(function () {})
      .then(function () {
        return self.clients.claim();
      })
  );
});

/* 앱이 "새 버전으로 갈아타자"고 하면 그때 교체한다 */
self.addEventListener("message", function (ev) {
  var msg = ev.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "VERSION" && ev.source) {
    try {
      ev.source.postMessage({ type: "VERSION", version: VERSION });
    } catch (e) {}
  }
});

function cachePut(request, response) {
  // 실패 응답과 opaque 응답은 캐시에 넣지 않는다 (다음에 못 고친다)
  if (!response || !response.ok || response.type === "opaque") return response;
  var copy = response.clone();
  caches
    .open(CACHE)
    .then(function (cache) {
      return cache.put(request, copy);
    })
    .catch(function () {
      /* 용량 초과 등. 캐시에 못 넣어도 이번 응답은 정상이다. */
    });
  return response;
}

function offlineFallback(request) {
  if (request.mode === "navigate") {
    return caches.match("./index.html").then(function (hit) {
      return hit || caches.match("./") || new Response("", { status: 504, statusText: "offline" });
    });
  }
  return Promise.resolve(new Response("", { status: 504, statusText: "offline" }));
}

/** 네트워크 먼저. 느리거나 끊기면 캐시. 어떤 경우에도 Response를 돌려준다. */
function networkFirst(request) {
  return new Promise(function (resolve) {
    var settled = false;

    function done(res) {
      if (settled) return;
      settled = true;
      resolve(res);
    }

    var timer = setTimeout(function () {
      if (settled) return;
      caches.match(request).then(function (hit) {
        if (hit) done(hit); // 네트워크는 계속 기다렸다가 캐시만 갱신한다
      });
    }, NET_TIMEOUT);

    fetch(request)
      .then(function (res) {
        clearTimeout(timer);
        cachePut(request, res.clone());
        done(res);
      })
      .catch(function () {
        clearTimeout(timer);
        caches
          .match(request)
          .then(function (hit) {
            if (hit) return hit;
            return offlineFallback(request);
          })
          .then(done, function () {
            done(new Response("", { status: 504, statusText: "offline" }));
          });
      });
  });
}

/** 캐시 먼저 보여주고 뒤에서 갱신 */
function staleWhileRevalidate(request) {
  return caches.match(request).then(function (hit) {
    var network = fetch(request)
      .then(function (res) {
        return cachePut(request, res);
      })
      .catch(function () {
        return hit || new Response("", { status: 504, statusText: "offline" });
      });
    return hit || network;
  });
}

self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Firebase 통신은 그대로 통과시킨다
  if (BYPASS_HOSTS.indexOf(url.hostname) >= 0) return;

  // 캐시를 건너뛰라고 명시한 요청(새로고침 등)은 존중한다
  if (req.cache === "no-store") return;

  if (url.origin === self.location.origin) {
    // 내 파일: 온라인이면 늘 최신을 본다
    ev.respondWith(networkFirst(req));
    return;
  }

  // 외부 파일(폰트, Firebase SDK): 무겁고 잘 안 바뀐다
  ev.respondWith(staleWhileRevalidate(req));
});
