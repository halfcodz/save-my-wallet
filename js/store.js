/* store.js — localStorage 데이터 레이어.
   - 스키마 버전 + 마이그레이션
   - 모든 쓰기는 "저장소에서 다시 읽고 -> 수정 -> 쓰기" (두 탭 동시 사용 대비)
   - 다른 탭의 변경은 storage 이벤트로 받아서 반영 */
(function (root, factory) {
  var api = factory(root.MP && root.MP.calc ? root.MP.calc : require("./calc.js"));
  root.MP = root.MP || {};
  root.MP.store = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (calc) {
  "use strict";

  var KEY = "moneyplan.v1";
  var SCHEMA_VERSION = 1;

  var DEFAULT_CATEGORIES = [
    ["🍚", "식사"], ["🍩", "카페/간식"], ["🍺", "술"], ["🚌", "교통"],
    ["⛽", "주유"], ["🛏", "숙박"], ["🎟", "입장료/관광"], ["🛍", "쇼핑"],
    ["🧻", "생필품"], ["💊", "의료"], ["📱", "통신/구독"], ["🎮", "취미/여가"],
    ["🎁", "선물"], ["✏️", "기타"]
  ];

  var listeners = [];
  var cache = null;

  /* ---------- 저장소 접근 (사파리 프라이빗 모드 등에서 던지는 경우 대비) ---------- */

  function storage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function rawRead() {
    var s = storage();
    if (!s) return null;
    try {
      return s.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function rawWrite(text) {
    var s = storage();
    if (!s) return false;
    try {
      s.setItem(KEY, text);
      return true;
    } catch (e) {
      return false; // 용량 초과 등. 메모리 상태는 유지된다.
    }
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function uid() {
    return (
      Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8)
    );
  }

  /* ---------- 초기값 / 정규화 ---------- */

  function defaultCategories() {
    return DEFAULT_CATEGORIES.map(function (c, i) {
      return { id: "cat_" + i, name: c[1], emoji: c[0], order: i, isDefault: true };
    });
  }

  /** 첫 실행: 카테고리만 있고 예산·지출은 비어 있다. */
  function initialData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      budgets: [],
      expenses: [],
      categories: defaultCategories(),
      settings: { activeBudgetId: null, theme: "light" }
    };
  }

  function toInt(v) {
    var n = Number(v);
    return isFinite(n) ? Math.round(n) : 0;
  }

  function str(v, fallback) {
    return typeof v === "string" ? v : fallback;
  }

  /**
   * 깨진/부분적인 데이터가 들어와도 앱이 죽지 않도록 정규화한다.
   * (다른 탭이 쓰는 도중이거나, 손으로 편집했거나, 예전 버전인 경우)
   */
  function sanitize(input) {
    var d = input && typeof input === "object" ? input : {};
    var out = initialData();

    if (Array.isArray(d.categories)) {
      var cats = d.categories
        .filter(function (c) {
          return c && typeof c === "object" && c.id;
        })
        .map(function (c, i) {
          return {
            id: String(c.id),
            name: str(c.name, "").trim() || "이름 없음",
            emoji: str(c.emoji, "").trim() || "✏️",
            order: typeof c.order === "number" ? c.order : i,
            isDefault: !!c.isDefault
          };
        })
        .sort(function (a, b) {
          return a.order - b.order;
        })
        .map(function (c, i) {
          c.order = i; // order를 0..n-1로 다시 조인다
          return c;
        });
      if (cats.length) out.categories = cats;
    }

    if (Array.isArray(d.budgets)) {
      out.budgets = d.budgets
        .filter(function (b) {
          return (
            b && typeof b === "object" && b.id &&
            calc.isISODate(b.startDate) && calc.isISODate(b.endDate)
          );
        })
        .map(function (b) {
          var start = b.startDate;
          var end = b.endDate;
          if (end < start) end = start; // 뒤집힌 기간 보정
          return {
            id: String(b.id),
            name: str(b.name, "").trim() || "예산",
            startDate: start,
            endDate: end,
            totalAmount: Math.max(0, toInt(b.totalAmount)),
            createdAt: toInt(b.createdAt) || 0
          };
        });
    }

    var budgetIds = {};
    out.budgets.forEach(function (b) {
      budgetIds[b.id] = true;
    });

    if (Array.isArray(d.expenses)) {
      out.expenses = d.expenses
        .filter(function (e) {
          return (
            e && typeof e === "object" && e.id &&
            budgetIds[e.budgetId] && // 소속 예산이 사라진 지출은 버린다
            calc.isISODate(e.date) &&
            toInt(e.amount) > 0
          );
        })
        .map(function (e) {
          var rec = {
            id: String(e.id),
            budgetId: String(e.budgetId),
            amount: Math.min(calc.MAX_AMOUNT, Math.max(1, toInt(e.amount))),
            // 카테고리가 삭제됐어도 id는 그대로 둔다
            categoryId: e.categoryId == null ? null : String(e.categoryId),
            memo: str(e.memo, ""),
            date: e.date,
            createdAt: toInt(e.createdAt) || 0
          };
          // 카테고리가 삭제될 때 남겨둔 이름/이모지 스냅샷
          if (str(e.categoryName, "").trim()) {
            rec.categoryName = e.categoryName.trim();
            rec.categoryEmoji = str(e.categoryEmoji, "").trim() || "✏️";
          }
          return rec;
        });
    }

    var st = d.settings && typeof d.settings === "object" ? d.settings : {};
    var active = st.activeBudgetId;
    if (!budgetIds[active]) active = out.budgets.length ? out.budgets[0].id : null;
    out.settings = {
      activeBudgetId: active,
      theme: st.theme === "dark" ? "dark" : "light"
    };

    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  /**
   * 스키마 버전별 변환. 지금은 v1뿐이라 정규화만 하지만,
   * 앞으로 버전이 올라가면 여기에 단계별 변환을 추가한다.
   */
  function migrate(raw) {
    if (!raw || typeof raw !== "object") return initialData();
    var v = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
    if (v > SCHEMA_VERSION) {
      // 더 새 버전이 쓴 데이터. 지우지 말고 읽을 수 있는 만큼만 읽는다.
      return sanitize(raw);
    }
    // v0(버전 필드 없음) -> v1: 구조가 같으므로 정규화로 충분
    return sanitize(raw);
  }

  function readFresh() {
    var text = rawRead();
    if (!text) return initialData();
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return initialData(); // 깨진 JSON: 초기 상태로 (덮어쓰지는 않는다)
    }
    return migrate(parsed);
  }

  function persist(data) {
    return rawWrite(JSON.stringify(data));
  }

  /* ---------- 공개 API ---------- */

  function load() {
    cache = readFresh();
    return cache;
  }

  function get() {
    if (!cache) load();
    return cache;
  }

  /**
   * 모든 변경은 이걸 통한다.
   * 저장소에서 방금 값을 다시 읽어와서 수정하므로,
   * 다른 탭이 그 사이에 쓴 내용을 통째로 덮어쓰지 않는다.
   */
  function update(mutator) {
    var draft = readFresh();
    var result = mutator(draft);
    var next = result === undefined ? draft : result;
    next.schemaVersion = SCHEMA_VERSION;
    cache = next;
    persist(next);
    emit();
    return cache;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](cache);
  }

  /** 다른 탭에서 바뀌면 다시 읽어서 화면을 갱신한다. */
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", function (ev) {
      if (ev.key !== null && ev.key !== KEY) return;
      cache = readFresh();
      emit();
    });
  }

  /**
   * 카테고리 삭제.
   * 그 카테고리를 쓴 지출은 지우지 않고, 이름/이모지를 지출에 남겨둔다.
   * (draft를 직접 고치는 헬퍼 — update() 안에서 쓴다)
   */
  function deleteCategory(draft, categoryId) {
    var target = null;
    for (var i = 0; i < draft.categories.length; i++) {
      if (draft.categories[i].id === categoryId) target = draft.categories[i];
    }
    if (!target) return draft;

    draft.expenses.forEach(function (e) {
      if (e.categoryId === categoryId) {
        e.categoryName = target.name;
        e.categoryEmoji = target.emoji;
      }
    });
    draft.categories = draft.categories
      .filter(function (c) {
        return c.id !== categoryId;
      })
      .map(function (c, i) {
        c.order = i;
        return c;
      });
    return draft;
  }

  /** 이 카테고리를 쓰고 있는 지출 건수 */
  function categoryUsageCount(data, categoryId) {
    return data.expenses.filter(function (e) {
      return e.categoryId === categoryId;
    }).length;
  }

  /** 테스트용 초기화 */
  function reset() {
    var s = storage();
    if (s) {
      try {
        s.removeItem(KEY);
      } catch (e) {}
    }
    cache = null;
  }

  return {
    KEY: KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    uid: uid,
    clone: clone,
    initialData: initialData,
    defaultCategories: defaultCategories,
    sanitize: sanitize,
    deleteCategory: deleteCategory,
    categoryUsageCount: categoryUsageCount,
    migrate: migrate,
    load: load,
    get: get,
    update: update,
    subscribe: subscribe,
    reset: reset,
    _readFresh: readFresh
  };
});
