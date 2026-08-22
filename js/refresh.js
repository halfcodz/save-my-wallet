/* refresh.js — 최신 상태로 맞추는 두 가지.
   1) MP.updater      배포된 새 버전을 감지하고 갈아 끼운다 (캐시에 발목 잡히지 않게)
   2) MP.pullToRefresh 화면을 위에서 아래로 당기면 새로고침

   웹앱(홈 화면에 추가)에는 주소창이 없어서 새로고침할 방법이 없다.
   그래서 당기는 동작으로 (a) 밀린 데이터 동기화 (b) 새 버전 확인을 함께 한다. */
(function () {
  "use strict";

  /* =================== 서비스 워커 업데이트 =================== */

  var updater = (function () {
    var reg = null;
    var waiting = null;      // 대기 중인 새 서비스 워커
    var reloading = false;
    var applying = false;
    var listeners = [];
    // 이 탭이 이미 서비스 워커의 관리를 받고 있었는지.
    // 처음 설치될 때도 controllerchange가 오는데, 그때는 새로고침하면 안 된다.
    var hadController = false;

    function supported() {
      return (
        typeof navigator !== "undefined" &&
        "serviceWorker" in navigator &&
        location.protocol.indexOf("http") === 0
      );
    }

    function emit() {
      for (var i = 0; i < listeners.length; i++) listeners[i](!!waiting);
    }

    function onUpdate(fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      };
    }

    function markWaiting(sw) {
      if (!sw || waiting === sw) return;
      waiting = sw;
      emit();
    }

    function watch(r) {
      // 이미 새 버전이 설치를 마치고 기다리는 중
      if (r.waiting && navigator.serviceWorker.controller) markWaiting(r.waiting);

      r.addEventListener("updatefound", function () {
        var sw = r.installing;
        if (!sw) return;
        sw.addEventListener("statechange", function () {
          // 관리 중인 워커가 이미 있는데 새 워커가 설치를 마쳤다 = 새 버전 도착
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            markWaiting(r.waiting || sw);
          }
        });
      });
    }

    function reloadOnce() {
      if (reloading) return;
      reloading = true;
      try {
        location.reload();
      } catch (e) {
        /* 새로고침이 막히면 그냥 둔다. 다음에 열 때 새 버전이 뜬다. */
      }
    }

    function install() {
      if (!supported()) return Promise.resolve(null);
      hadController = !!navigator.serviceWorker.controller;

      navigator.serviceWorker.addEventListener("controllerchange", function () {
        // 첫 설치로 바뀐 것이면 지금 화면이 멀쩡하므로 건드리지 않는다
        if (!applying && !hadController) return;
        reloadOnce();
      });

      return navigator.serviceWorker
        // updateViaCache:"none" — sw.js 자체가 브라우저 HTTP 캐시에 갇히지 않게
        .register("sw.js", { updateViaCache: "none" })
        .then(function (r) {
          reg = r;
          watch(r);
          return r;
        })
        .catch(function () {
          return null; // 서비스 워커가 없어도 앱은 그대로 동작한다
        });
    }

    /** 서버에 새 버전이 올라왔는지 확인. 있으면 true. */
    function check() {
      if (!supported()) return Promise.resolve(false);
      if (!reg) {
        return navigator.serviceWorker
          .getRegistration()
          .then(function (r) {
            if (!r) return false;
            reg = r;
            watch(r);
            return r.update().then(function () {
              return !!waiting;
            });
          })
          .catch(function () {
            return false;
          });
      }
      return reg
        .update()
        .then(function () {
          return !!waiting;
        })
        .catch(function () {
          return false; // 오프라인이면 조용히 넘어간다
        });
    }

    function hasUpdate() {
      return !!waiting;
    }

    /** 대기 중인 새 버전으로 갈아타고 새로고침 */
    function apply() {
      if (!waiting) return false;
      applying = true;
      try {
        waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (e) {
        reloadOnce();
        return true;
      }
      // controllerchange가 끝내 안 오는 경우에 대비한 안전장치
      setTimeout(reloadOnce, 3000);
      return true;
    }

    /**
     * 최후의 수단. 캐시와 서비스 워커를 다 지우고 새로 받는다.
     * (배포가 꼬여서 옛 화면이 계속 보일 때)
     */
    function hardReset() {
      var jobs = [];
      if (typeof caches !== "undefined") {
        jobs.push(
          caches
            .keys()
            .then(function (keys) {
              return Promise.all(
                keys.map(function (k) {
                  return caches.delete(k).catch(function () {});
                })
              );
            })
            .catch(function () {})
        );
      }
      if (supported()) {
        jobs.push(
          navigator.serviceWorker
            .getRegistrations()
            .then(function (list) {
              return Promise.all(
                list.map(function (r) {
                  return r.unregister().catch(function () {});
                })
              );
            })
            .catch(function () {})
        );
      }
      return Promise.all(jobs).then(function () {
        reloading = true; // 아래 reload가 유일한 새로고침이 되도록
        try {
          location.reload();
        } catch (e) {}
      });
    }

    return {
      supported: supported,
      install: install,
      check: check,
      apply: apply,
      hasUpdate: hasUpdate,
      onUpdate: onUpdate,
      hardReset: hardReset
    };
  })();

  /* =================== 당겨서 새로고침 =================== */

  var pullToRefresh = (function () {
    var THRESHOLD = 68;   // 이만큼 당기면 새로고침
    var MAX = 116;        // 더 당겨도 여기까지만 내려온다
    var RESIST = 0.55;    // 손가락이 간 거리의 절반쯤만 따라간다

    var opts = null;
    var wrap = null;
    var mover = null;
    var dot = null;

    var startY = 0;
    var startX = 0;
    var tracking = false;   // 손가락이 화면에 닿아 있고 후보로 보고 있음
    var engaged = false;    // 당기기로 확정 (이후 스크롤을 막는다)
    var offset = 0;
    var busy = false;

    function build(host) {
      wrap = document.createElement("div");
      wrap.className = "mm-ptr";
      wrap.setAttribute("aria-hidden", "true");
      mover = document.createElement("div");
      mover.className = "mm-ptr-move";
      dot = document.createElement("div");
      dot.className = "mm-ptr-dot";
      mover.appendChild(dot);
      wrap.appendChild(mover);
      host.appendChild(wrap);
    }

    function paint(animate) {
      if (!mover) return;
      mover.style.transition = animate ? "transform .22s ease, opacity .22s ease" : "";
      mover.style.transform = "translateY(" + offset.toFixed(1) + "px)";
      mover.style.opacity = String(Math.min(1, offset / (THRESHOLD * 0.7)));
      if (!busy) {
        // 당긴 만큼 돌아간다 — 임계점에 닿으면 한 바퀴
        dot.style.transform = "rotate(" + Math.min(360, (offset / THRESHOLD) * 360).toFixed(0) + "deg)";
      }
    }

    function reset(animate) {
      offset = 0;
      busy = false;
      engaged = false;
      tracking = false;
      if (wrap) wrap.classList.remove("mm-ptr-busy");
      if (dot) dot.style.transform = "";
      paint(animate !== false);
    }

    function canStart() {
      if (busy) return false;
      if (!opts || typeof opts.canPull !== "function") return false;
      if (!opts.canPull()) return false;
      var sc = opts.scroller();
      // 스크롤이 맨 위에 있을 때만. 중간에서 당기면 그냥 스크롤이어야 한다.
      return !sc || sc.scrollTop <= 0;
    }

    function onStart(ev) {
      if (ev.touches.length !== 1) {
        tracking = false;
        return;
      }
      if (!canStart()) return;
      tracking = true;
      engaged = false;
      startY = ev.touches[0].clientY;
      startX = ev.touches[0].clientX;
    }

    function onMove(ev) {
      if (!tracking || busy) return;
      if (ev.touches.length !== 1) {
        reset();
        return;
      }

      var dy = ev.touches[0].clientY - startY;
      var dx = ev.touches[0].clientX - startX;

      if (!engaged) {
        // 위로 올리거나 가로로 긋는 동작이면 손을 뗀다 (스크롤·스와이프 삭제와 겹치지 않게)
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          if (Math.abs(dx) > 6 || dy < -6) tracking = false;
          return;
        }
        if (dy < 12) return; // 아주 작은 흔들림은 무시
        // 당기는 사이에 스크롤이 움직였으면 취소
        var sc = opts.scroller();
        if (sc && sc.scrollTop > 0) {
          tracking = false;
          return;
        }
        engaged = true;
        if (typeof opts.onEngage === "function") opts.onEngage();
      }

      // 여기부터는 우리 동작이다. 브라우저의 고무줄 스크롤을 막는다.
      if (ev.cancelable) ev.preventDefault();
      offset = Math.min(MAX, dy * RESIST);
      paint(false);
    }

    function onEnd() {
      if (!tracking) return;
      if (!engaged) {
        tracking = false;
        return;
      }
      tracking = false;

      if (offset < THRESHOLD) {
        reset(true);
        return;
      }

      busy = true;
      offset = THRESHOLD;
      if (wrap) wrap.classList.add("mm-ptr-busy");
      paint(true);

      var done = false;
      function finish() {
        if (done) return;
        done = true;
        reset(true);
      }

      var result;
      try {
        result = opts.onRefresh();
      } catch (e) {
        finish();
        return;
      }
      // 무슨 일이 있어도 표시는 반드시 사라진다
      Promise.resolve(result).then(finish, finish);
      setTimeout(finish, 12000);
    }

    function install(o) {
      opts = o;
      build(o.host);
      var host = o.host;
      host.addEventListener("touchstart", onStart, { passive: true });
      host.addEventListener("touchmove", onMove, { passive: false });
      host.addEventListener("touchend", onEnd, { passive: true });
      host.addEventListener("touchcancel", function () {
        reset(true);
      }, { passive: true });
      reset(false);
    }

    /** 메뉴에서 누른 경우처럼 손가락 없이 새로고침할 때 */
    function trigger() {
      if (busy || !opts) return Promise.resolve();
      busy = true;
      offset = THRESHOLD;
      if (wrap) wrap.classList.add("mm-ptr-busy");
      paint(true);
      return Promise.resolve()
        .then(opts.onRefresh)
        .catch(function () {})
        .then(function () {
          reset(true);
        });
    }

    return { install: install, trigger: trigger };
  })();

  window.MP = window.MP || {};
  window.MP.updater = updater;
  window.MP.pullToRefresh = pullToRefresh;
})();
