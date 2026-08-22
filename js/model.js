/* model.js — 순수 데이터 모델.
   저장소(Firestore / localStorage)도 DOM도 모른다. 값을 다듬는 함수만 둔다.
   브라우저(전역 MP.model)와 node(require) 양쪽에서 동작한다. */
(function (root, factory) {
  var api = factory(root.MP && root.MP.calc ? root.MP.calc : require("./calc.js"));
  root.MP = root.MP || {};
  root.MP.model = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (calc) {
  "use strict";

  /* localStorage에만 쓰이던 스키마. 지금은 옛 데이터를 읽어 올릴 때만 쓴다. */
  var SCHEMA_VERSION = 1;
  var LEGACY_KEY = "moneyplan.v1";

  /* 초대 코드: 헷갈리는 글자(I, O, 0, 1)를 뺀 32자 × 8자리 */
  var INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var INVITE_LENGTH = 8;
  var MAX_MEMBERS = 20;

  var DEFAULT_CATEGORIES = [
    ["🍚", "식사"], ["🍩", "카페/간식"], ["🍺", "술"], ["🚌", "교통"],
    ["⛽", "주유"], ["🛏", "숙박"], ["🎟", "입장료/관광"], ["🛍", "쇼핑"],
    ["🧻", "생필품"], ["💊", "의료"], ["📱", "통신/구독"], ["🎮", "취미/여가"],
    ["🎁", "선물"], ["✏️", "기타"]
  ];

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function uid() {
    return (
      Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 8)
    );
  }

  /** 초대 코드 생성. 사람이 불러주고 받아 적을 수 있는 길이. */
  function newInviteCode() {
    var out = "";
    for (var i = 0; i < INVITE_LENGTH; i++) {
      out += INVITE_ALPHABET.charAt(Math.floor(Math.random() * INVITE_ALPHABET.length));
    }
    return out;
  }

  /** 사용자가 친 코드를 관대하게 받는다 (소문자·공백·하이픈 허용, 헷갈리는 글자 교정) */
  function normalizeInviteCode(input) {
    var s = String(input == null ? "" : input).toUpperCase().replace(/[^A-Z0-9]/g, "");
    var fixed = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "0") ch = "O";
      else if (ch === "1") ch = "I";
      fixed += ch;
    }
    return fixed.slice(0, INVITE_LENGTH);
  }

  function isInviteCode(s) {
    return typeof s === "string" && s.length === INVITE_LENGTH && /^[A-Z0-9]+$/.test(s);
  }

  /* ---------- 초기값 ---------- */

  function defaultCategories() {
    return DEFAULT_CATEGORIES.map(function (c, i) {
      return { id: "cat_" + i, name: c[1], emoji: c[0], order: i, isDefault: true };
    });
  }

  /** 갓 만든 계정: 카테고리만 있고 예산·지출은 비어 있다. */
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

  /** 문자열만 남기고 중복을 없앤 배열 */
  function strList(v) {
    if (!Array.isArray(v)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < v.length; i++) {
      if (typeof v[i] !== "string" || !v[i] || seen[v[i]]) continue;
      seen[v[i]] = true;
      out.push(v[i]);
    }
    return out;
  }

  /* ---------- 정규화 ---------- */

  /** 예산 한 건. 서버에서 온 값이든 옛 localStorage 값이든 같은 모양으로 만든다. */
  function normalizeBudget(b) {
    var start = b.startDate;
    var end = b.endDate;
    if (end < start) end = start; // 뒤집힌 기간 보정

    var owner = str(b.ownerUid, "") || null;
    var memberUids = strList(b.memberUids);
    if (owner && memberUids.indexOf(owner) < 0) memberUids.unshift(owner);

    var members = {};
    if (b.members && typeof b.members === "object" && !Array.isArray(b.members)) {
      Object.keys(b.members).forEach(function (k) {
        var m = b.members[k];
        members[k] = { name: (m && str(m.name, "").trim()) || "이름 없음" };
      });
    }
    // 목록에는 있는데 이름이 없는 사람도 자리는 만들어 준다
    memberUids.forEach(function (u) {
      if (!members[u]) members[u] = { name: "이름 없음" };
    });

    var code = str(b.inviteCode, "").toUpperCase();

    return {
      id: String(b.id),
      name: str(b.name, "").trim() || "예산",
      startDate: start,
      endDate: end,
      totalAmount: Math.max(0, toInt(b.totalAmount)),
      createdAt: toInt(b.createdAt) || 0,
      ownerUid: owner,
      memberUids: memberUids,
      members: members,
      // 저장된 플래그를 믿지 않고 실제 상태에서 끌어낸다
      // (초대 코드가 살아 있거나, 나 말고 다른 사람이 있으면 함께 쓰는 예산)
      shared: memberUids.length > 1 || isInviteCode(code),
      inviteCode: isInviteCode(code) ? code : null
    };
  }

  /** 지출 한 건 */
  function normalizeExpense(e) {
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
    // 누가 썼는지 (공유 예산의 사람별 합계·정산에 쓴다)
    if (str(e.uid, "").trim()) rec.uid = e.uid.trim();
    if (str(e.userName, "").trim()) rec.userName = e.userName.trim();
    // 카테고리가 삭제됐거나, 상대방 목록에 없을 때 쓸 이름/이모지 스냅샷
    if (str(e.categoryName, "").trim()) {
      rec.categoryName = e.categoryName.trim();
      rec.categoryEmoji = str(e.categoryEmoji, "").trim() || "✏️";
    }
    return rec;
  }

  function isUsableBudget(b) {
    return !!(
      b && typeof b === "object" && b.id &&
      calc.isISODate(b.startDate) && calc.isISODate(b.endDate)
    );
  }

  function isUsableExpense(e, budgetIds) {
    return !!(
      e && typeof e === "object" && e.id &&
      budgetIds[e.budgetId] && // 소속 예산이 사라진 지출은 버린다
      calc.isISODate(e.date) &&
      toInt(e.amount) > 0
    );
  }

  function normalizeCategories(list) {
    return list
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
  }

  /**
   * 깨진/부분적인 데이터가 들어와도 앱이 죽지 않도록 정규화한다.
   * (서버가 반쯤 쓴 상태이거나, 손으로 편집했거나, 예전 버전인 경우)
   */
  function sanitize(input) {
    var d = input && typeof input === "object" ? input : {};
    var out = initialData();

    if (Array.isArray(d.categories)) {
      var cats = normalizeCategories(d.categories);
      if (cats.length) out.categories = cats;
    }

    if (Array.isArray(d.budgets)) {
      out.budgets = d.budgets.filter(isUsableBudget).map(normalizeBudget);
    }

    var budgetIds = {};
    out.budgets.forEach(function (b) {
      budgetIds[b.id] = true;
    });

    if (Array.isArray(d.expenses)) {
      out.expenses = d.expenses
        .filter(function (e) {
          return isUsableExpense(e, budgetIds);
        })
        .map(normalizeExpense);
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

  /* ---------- 카테고리 ---------- */

  /**
   * 카테고리 삭제.
   * 그 카테고리를 쓴 지출은 지우지 않고, 이름/이모지를 지출에 남겨둔다.
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

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    LEGACY_KEY: LEGACY_KEY,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    INVITE_LENGTH: INVITE_LENGTH,
    MAX_MEMBERS: MAX_MEMBERS,
    clone: clone,
    uid: uid,
    newInviteCode: newInviteCode,
    normalizeInviteCode: normalizeInviteCode,
    isInviteCode: isInviteCode,
    defaultCategories: defaultCategories,
    initialData: initialData,
    normalizeBudget: normalizeBudget,
    normalizeExpense: normalizeExpense,
    normalizeCategories: normalizeCategories,
    isUsableBudget: isUsableBudget,
    isUsableExpense: isUsableExpense,
    sanitize: sanitize,
    migrate: migrate,
    deleteCategory: deleteCategory,
    categoryUsageCount: categoryUsageCount
  };
});
