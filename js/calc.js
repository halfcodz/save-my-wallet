/* calc.js — 순수 계산/포맷 함수. DOM도 localStorage도 건드리지 않는다.
   브라우저(전역 MP.calc)와 node(require) 양쪽에서 동작한다. */
(function (root, factory) {
  var api = factory();
  root.MP = root.MP || {};
  root.MP.calc = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DAY_MS = 86400000;
  var MAX_AMOUNT = 999999999; // 키패드 상한 (9자리)
  var WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  /* ---------- 날짜 ---------- */

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** Date -> "YYYY-MM-DD" (로컬 시간 기준) */
  function todayISO(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function isISODate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }

  /** "YYYY-MM-DD" -> 로컬 자정 Date (요일/월일 표시에만 사용) */
  function parseISO(s) {
    var p = String(s).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /** 일수 차이(b - a). UTC 기준 정수 연산이라 DST/시간대 영향을 받지 않는다. */
  function diffDays(aISO, bISO) {
    var a = String(aISO).split("-").map(Number);
    var b = String(bISO).split("-").map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
  }

  function addDays(iso, n) {
    var p = String(iso).split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  /** 남은 일수: 오늘 포함해서 종료일까지. 오늘이 마지막 날이면 1, 지났으면 0 이하. */
  function daysLeft(todayIso, endIso) {
    return diffDays(todayIso, endIso) + 1;
  }

  /** 그 날짜가 속한 달의 1일과 말일 */
  function monthBounds(iso) {
    var p = String(iso).split("-").map(Number);
    var lastDay = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    return {
      start: p[0] + "-" + pad2(p[1]) + "-01",
      end: p[0] + "-" + pad2(p[1]) + "-" + pad2(lastDay)
    };
  }

  /** "8월" */
  function monthLabel(iso) {
    return Number(String(iso).split("-")[1]) + "월";
  }

  function isPersonal(budget) {
    return !!budget && budget.kind === "personal";
  }

  /**
   * 화면이 실제로 다루는 기간.
   * 여행 예산은 정해 둔 기간 그대로.
   * 나의 가계부는 달마다 새로 시작하므로 오늘이 속한 달로 본다.
   */
  function effectiveBudget(budget, todayIso) {
    if (!isPersonal(budget)) return budget;
    // 안에서 기간을 직접 정했으면 그걸 쓴다
    if (budget.periodMode === "custom") return budget;
    var m = monthBounds(todayIso);
    var out = {};
    for (var k in budget) {
      if (Object.prototype.hasOwnProperty.call(budget, k)) out[k] = budget[k];
    }
    out.startDate = m.start;
    out.endDate = m.end;
    return out;
  }

  /** 이 예산에 속한 지출. 나의 가계부는 이번 달 것만 센다. */
  function budgetExpenses(expenses, budget, todayIso) {
    var list = expensesOfBudget(expenses, budget.id);
    if (!isPersonal(budget) || budget.periodMode === "custom") return list;
    var b = effectiveBudget(budget, todayIso);
    return list.filter(function (e) {
      return e.date >= b.startDate && e.date <= b.endDate;
    });
  }

  /** 그 달의 1일로 n달 이동 */
  function addMonths(iso, n) {
    var p = String(iso).split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-01";
  }

  /**
   * 달력 격자. 일요일 시작, 항상 6주 42칸이라 달을 넘겨도 높이가 흔들리지 않는다.
   * 각 칸: { date, inMonth }
   */
  function monthGrid(iso) {
    var m = monthBounds(iso);
    var lead = parseISO(m.start).getDay(); // 0 = 일요일
    var first = addDays(m.start, -lead);
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var days = [];
      for (var d = 0; d < 7; d++) {
        var date = addDays(first, w * 7 + d);
        days.push({ date: date, inMonth: date >= m.start && date <= m.end });
      }
      weeks.push(days);
    }
    return weeks;
  }

  /** 날짜 -> { sum, items } 로 바로 찾을 수 있게 */
  function indexByDate(expenses) {
    var out = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      if (!out[e.date]) out[e.date] = { sum: 0, items: [] };
      out[e.date].sum += e.amount;
      out[e.date].items.push(e);
    }
    return out;
  }

  /** 'upcoming' | 'active' | 'ended' */
  function budgetStatus(budget, todayIso) {
    if (todayIso > budget.endDate) return "ended";
    if (todayIso < budget.startDate) return "upcoming";
    return "active";
  }

  /* ---------- 금액 ---------- */

  /** 100원 단위 내림. 음수도 진짜 내림(-1 -> -100). */
  function floorTo100(n) {
    return Math.floor(n / 100) * 100;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function isValidAmount(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n > 0 && n <= MAX_AMOUNT;
  }

  /** 문자열 입력 -> 원 단위 정수 (숫자 아닌 문자 제거) */
  function parseAmount(str) {
    var digits = String(str == null ? "" : str).replace(/[^0-9]/g, "");
    if (!digits) return 0;
    var n = Number(digits.slice(0, 12));
    return n > MAX_AMOUNT ? MAX_AMOUNT : n;
  }

  /** 키패드 한 타 입력. key: "0"~"9" | "00" | "⌫" */
  function pressKey(amount, key) {
    if (key === "⌫") return Math.floor(amount / 10);
    var next = Number(String(amount) + (key === "00" ? "00" : key));
    if (!isFinite(next) || next > MAX_AMOUNT) return amount; // 상한 넘으면 무시
    return next;
  }

  function formatWon(n) {
    return Math.round(n).toLocaleString("ko-KR");
  }

  /* ---------- 집계 ---------- */

  function sumAmount(list) {
    var t = 0;
    for (var i = 0; i < list.length; i++) t += list[i].amount;
    return t;
  }

  /** 해당 예산의 지출을 날짜 내림차순 -> 입력 최신순으로 정렬해서 반환 */
  function expensesOfBudget(expenses, budgetId) {
    return expenses
      .filter(function (e) {
        return e.budgetId === budgetId;
      })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.createdAt - a.createdAt;
      });
  }

  /**
   * 메인 화면 수치 일괄 계산.
   * - remaining: 0 이하도 음수 그대로 (막지 않는다)
   * - dailyBudget: 하루 사용 가능한 금액. 하루치 안에서는 흔들리지 않지만,
   *                넘겨 쓰면 남은 날로 다시 나눈 값으로 즉시 낮아진다
   * - todayLeft: 하루치에서 오늘 쓴 만큼 뺀 값. 넘겼으면 음수
   * - dailyBudget / todayLeft: 기간이 끝났으면 null (화면에서 숨긴다)
   */
  function computeBudgetStats(budget, expenses, todayIso) {
    // 나의 가계부는 이번 달만 본다 (effectiveBudget / budgetExpenses가 걸러 준다)
    var b = effectiveBudget(budget, todayIso);
    var list = budgetExpenses(expenses, budget, todayIso);
    var total = b.totalAmount;
    var spent = sumAmount(list);
    var remaining = total - spent;
    var todaySpent = sumAmount(
      list.filter(function (e) {
        return e.date === todayIso;
      })
    );
    var status = budgetStatus(b, todayIso);
    var left = daysLeft(todayIso, b.endDate);
    var ended = status === "ended";

    /* 오늘 몫으로 잡아 둔 하루치.
       오늘을 시작할 때 남아 있던 돈(= 남은 금액 + 오늘 쓴 돈)을 오늘 포함 남은 날로 나눈다.
       오늘 쓴 돈을 도로 더해서 나누므로, 하루치 안에서 쓰는 동안은 이 값이 흔들리지 않는다. */
    var base = ended ? null : floorTo100((remaining + todaySpent) / left);
    /* 오늘 쓸 수 있는 돈 = 하루치에서 오늘 쓴 만큼 뺀 것.
       하루치를 넘겼으면 음수 그대로 보여준다 (막지 않는다). */
    var todayLeft = base === null ? null : base - todaySpent;
    var overToday = todayLeft !== null && todaySpent > 0 && todayLeft < 0;

    /* 넘겨 썼으면 오늘 몫은 이미 끝났다. 남은 금액을 내일부터 남은 날로 다시 나눠서
       "앞으로 하루에 쓸 수 있는 평균"을 그 자리에서 낮춘다.
       이 값은 내일이 되면 base와 같아지므로 화면의 숫자가 이어진다.
       마지막 날이라 나눌 날이 없으면 남은 금액을 그대로 본다. */
    var dailyBudget =
      base === null ? null :
      overToday ? floorTo100(remaining / Math.max(1, left - 1)) : base;

    // 한도를 정하지 않은 가계부(그냥 기록용)는 남은 금액 대신 하루 평균을 본다
    var hasLimit = total > 0;
    var span = diffDays(b.startDate, b.endDate) + 1;
    var elapsed = clamp(diffDays(b.startDate, todayIso) + 1, 1, span);

    return {
      total: total,
      hasLimit: hasLimit,
      elapsedDays: elapsed,
      avgPerDay: Math.round(spent / elapsed),
      spent: spent,
      remaining: remaining,
      todaySpent: todaySpent,
      daysLeft: ended ? 0 : left,
      status: status,
      ended: ended,
      dailyBudget: dailyBudget,
      todayLeft: todayLeft,
      spentPct: total > 0 ? clamp((spent / total) * 100, 0, 100) : 0,
      // 오늘 하루치를 넘겼는지 (게이지 빗금 표시용)
      overToday: overToday,
      count: list.length
    };
  }

  /**
   * 달력에서 고른 하루의 수치. 그날 아침에 홈 화면이 보여줬을 값을 되살린다.
   * 그날 이후에 쓴 돈은 아직 없던 것으로 보고, 그날 이전 지출만 빼서 다시 나눈다.
   * 규칙은 computeBudgetStats와 같아서, 오늘을 고르면 홈 화면과 같은 숫자가 나온다.
   * 기간 밖 날짜나 한도 없는 가계부에서는 dailyBudget / dayLeft 가 null (화면에서 숨긴다).
   */
  function computeDayStats(budget, expenses, dateIso) {
    // 나의 가계부는 그 날짜가 속한 달로 본다
    var b = effectiveBudget(budget, dateIso);
    var list = budgetExpenses(expenses, budget, dateIso);
    var before = 0;
    var daySpent = 0;
    var count = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].date < dateIso) before += list[i].amount;
      else if (list[i].date === dateIso) {
        daySpent += list[i].amount;
        count++;
      }
    }

    var opening = b.totalAmount - before; // 그날 아침에 남아 있던 돈
    var left = daysLeft(dateIso, b.endDate);
    var inPeriod = dateIso >= b.startDate && dateIso <= b.endDate;
    var hasLimit = b.totalAmount > 0;
    var usable = inPeriod && hasLimit && left > 0;

    var base = usable ? floorTo100(opening / left) : null;
    var dayLeft = base === null ? null : base - daySpent;
    var over = dayLeft !== null && daySpent > 0 && dayLeft < 0;

    return {
      date: dateIso,
      hasLimit: hasLimit,
      inPeriod: inPeriod,
      usable: usable,
      daySpent: daySpent,
      count: count,
      daysLeft: left > 0 ? left : 0,
      // 넘겨 썼으면 그날 몫은 끝났다. 남은 돈을 다음 날부터 남은 날로 다시 나눈다.
      dailyBudget:
        base === null ? null :
        over ? floorTo100((opening - daySpent) / Math.max(1, left - 1)) : base,
      dayLeft: dayLeft,
      over: over
    };
  }

  /** "8/21" — 달력에서 고른 날짜를 라벨에 넣을 때 */
  function shortDate(dateIso) {
    var d = parseISO(dateIso);
    return d.getMonth() + 1 + "/" + d.getDate();
  }

  /** 카테고리별 합계 -> 큰 순서. 삭제된 카테고리도 이름을 유지한 채 자기 줄로 남는다. */
  function categoryShares(expenses, categories) {
    var byId = {};
    var meta = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      var key = String(e.categoryId);
      byId[key] = (byId[key] || 0) + e.amount;
      if (!meta[key]) meta[key] = resolveCategory(e, categories);
    }
    var total = sumAmount(expenses);
    return Object.keys(byId)
      .sort(function (a, b) {
        return byId[b] - byId[a];
      })
      .map(function (id) {
        var c = meta[id];
        return {
          categoryId: id,
          emoji: c.emoji,
          name: c.name,
          deleted: c.deleted,
          amount: byId[id],
          pct: total > 0 ? (byId[id] / total) * 100 : 0
        };
      });
  }

  /** 날짜별 묶음 (expensesOfBudget 정렬을 유지) */
  function groupByDate(expenses) {
    var out = [];
    var index = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      if (index[e.date] === undefined) {
        index[e.date] = out.length;
        out.push({ date: e.date, items: [], sum: 0 });
      }
      var g = out[index[e.date]];
      g.items.push(e);
      g.sum += e.amount;
    }
    return out;
  }

  /* ---------- 카테고리 ---------- */

  var DELETED_CATEGORY = { id: null, emoji: "✏️", name: "카테고리 없음" };

  /** id로 카테고리 조회. 없으면 null. */
  function findCategory(categories, id) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return null;
  }

  /**
   * 지출에 표시할 카테고리.
   * - 카테고리가 살아 있으면 그걸 쓴다 (이름을 고치면 지출에도 바로 반영)
   * - 삭제됐으면 지출에 남겨둔 이름/이모지 스냅샷을 쓴다
   */
  function resolveCategory(expense, categories) {
    var live = findCategory(categories, expense.categoryId);
    if (live) return { id: live.id, emoji: live.emoji, name: live.name, deleted: false };
    if (expense.categoryName) {
      return {
        id: expense.categoryId,
        emoji: expense.categoryEmoji || DELETED_CATEGORY.emoji,
        name: expense.categoryName,
        deleted: true
      };
    }
    return {
      id: expense.categoryId,
      emoji: DELETED_CATEGORY.emoji,
      name: DELETED_CATEGORY.name,
      deleted: true
    };
  }

  /**
   * 입력 화면 카테고리 정렬: order 기준을 유지하되 최근·자주 쓴 것을 앞으로.
   * 점수 = Σ 0.5^(경과일/10)  (반감기 10일)
   */
  function sortCategoriesByUsage(categories, expenses, todayIso) {
    var score = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      var age = Math.max(0, diffDays(e.date, todayIso));
      score[e.categoryId] = (score[e.categoryId] || 0) + Math.pow(0.5, age / 10);
    }
    return categories
      .slice()
      .sort(function (a, b) {
        var d = (score[b.id] || 0) - (score[a.id] || 0);
        if (d !== 0) return d;
        return a.order - b.order;
      });
  }

  /* ---------- 공유 예산: 사람별 집계 / 정산 ---------- */

  var UNKNOWN_MEMBER = "알 수 없음";

  /** 예산에 기록된 멤버 이름. 없으면 지출에 남은 이름, 그것도 없으면 '알 수 없음'. */
  function memberName(budget, uid, fallback) {
    var m = budget && budget.members ? budget.members[uid] : null;
    if (m && m.name) return m.name;
    if (fallback) return fallback;
    return UNKNOWN_MEMBER;
  }

  /**
   * 누구와 함께 쓰고 있는지 한 줄로.
   * 나를 맨 앞에 두고("나"), 너무 많으면 뒤는 "외 N명"으로 접는다.
   */
  function memberNames(budget, myUid, max) {
    var uids = budget && Array.isArray(budget.memberUids) ? budget.memberUids : [];
    if (!uids.length) return "";

    var limit = max || 3;
    var ordered = [];
    if (uids.indexOf(myUid) >= 0) ordered.push(myUid);
    for (var i = 0; i < uids.length; i++) {
      if (uids[i] !== myUid) ordered.push(uids[i]);
    }

    var names = ordered.map(function (u) {
      return u === myUid ? "나" : memberName(budget, u, "");
    });
    if (names.length <= limit) return names.join(" · ");
    return names.slice(0, limit).join(" · ") + " 외 " + (names.length - limit) + "명";
  }

  /**
   * 함께 쓰는 사람을 동그라미 하나씩으로 보여주기 위한 목록.
   * 이름의 첫 글자만 쓴다 — 한글은 첫 글자만으로도 대체로 구분된다.
   * 넘치면 뒤를 접고 몇 명이 더 있는지만 알려 준다.
   */
  function memberInitials(budget, myUid, max) {
    var uids = budget && Array.isArray(budget.memberUids) ? budget.memberUids : [];
    if (!uids.length) return { people: [], more: 0 };

    var limit = max || 4;
    var ordered = [];
    if (uids.indexOf(myUid) >= 0) ordered.push(myUid);
    for (var i = 0; i < uids.length; i++) {
      if (uids[i] !== myUid) ordered.push(uids[i]);
    }

    var people = ordered.slice(0, limit).map(function (u) {
      var mine = u === myUid;
      var name = mine ? "나" : memberName(budget, u, "");
      // 이모지가 섞인 이름도 한 글자로 잘리게 (surrogate pair 대비)
      var chars = typeof Array.from === "function" ? Array.from(name) : String(name).split("");
      return { uid: u, initial: chars.length ? chars[0] : "?", isMe: mine };
    });

    return { people: people, more: Math.max(0, ordered.length - people.length) };
  }

  /**
   * 사람별 지출 합계 (많이 쓴 순).
   * 아직 한 푼도 안 쓴 멤버도 0원으로 자기 줄을 갖는다 — 정산에 필요하다.
   */
  function memberShares(expenses, budget) {
    var by = {};
    var names = {};
    var i;

    for (i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      var key = e.uid || "";
      by[key] = (by[key] || 0) + e.amount;
      if (!names[key] && e.userName) names[key] = e.userName;
    }

    var uids = budget && Array.isArray(budget.memberUids) ? budget.memberUids : [];
    for (i = 0; i < uids.length; i++) {
      if (by[uids[i]] === undefined) by[uids[i]] = 0;
    }

    var total = 0;
    Object.keys(by).forEach(function (k) {
      total += by[k];
    });

    return Object.keys(by)
      .sort(function (a, b) {
        if (by[b] !== by[a]) return by[b] - by[a];
        return a < b ? -1 : a > b ? 1 : 0; // 금액이 같으면 uid 순 — 순서가 흔들리지 않게
      })
      .map(function (u) {
        return {
          uid: u,
          name: memberName(budget, u, names[u]),
          amount: by[u],
          pct: total > 0 ? (by[u] / total) * 100 : 0
        };
      });
  }

  /**
   * n빵 정산: 각자 낸 돈을 균등하게 맞추려면 누가 누구에게 얼마를 주면 되는지.
   * 많이 받을 사람과 많이 줄 사람을 큰 것부터 짝지어서 송금 횟수를 줄인다.
   */
  function settlement(shares) {
    var n = shares.length;
    if (n < 2) return [];

    var total = 0;
    shares.forEach(function (s) {
      total += s.amount;
    });
    if (total <= 0) return [];

    var per = total / n;
    var creditors = []; // 더 낸 사람 = 받을 사람
    var debtors = [];   // 덜 낸 사람 = 줄 사람

    shares.forEach(function (s) {
      var d = s.amount - per;
      if (d >= 0.5) creditors.push({ uid: s.uid, name: s.name, left: d });
      else if (d <= -0.5) debtors.push({ uid: s.uid, name: s.name, left: -d });
    });

    function bigFirst(a, b) {
      if (b.left !== a.left) return b.left - a.left;
      return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
    }
    creditors.sort(bigFirst);
    debtors.sort(bigFirst);

    var out = [];
    var i = 0;
    var j = 0;
    // 최대 송금 횟수는 n-1건. 부동소수점이 튀어도 무한 루프에 빠지지 않게 막아 둔다.
    var guard = 0;
    while (i < debtors.length && j < creditors.length && guard < n * 2) {
      guard++;
      var amount = Math.min(debtors[i].left, creditors[j].left);
      var won = Math.round(amount);
      if (won > 0) {
        out.push({
          fromUid: debtors[i].uid,
          fromName: debtors[i].name,
          toUid: creditors[j].uid,
          toName: creditors[j].name,
          amount: won
        });
      }
      debtors[i].left -= amount;
      creditors[j].left -= amount;
      if (debtors[i].left < 0.5) i++;
      if (creditors[j].left < 0.5) j++;
    }
    return out;
  }

  /* ---------- 라벨 ---------- */

  /** "8/1–8/31" */
  function periodLabel(budget) {
    var a = parseISO(budget.startDate);
    var z = parseISO(budget.endDate);
    return a.getMonth() + 1 + "/" + a.getDate() + "–" + (z.getMonth() + 1) + "/" + z.getDate();
  }

  /** "오늘 · 8월 22일 (토)" */
  function dayLabel(dateIso, todayIso) {
    var d = parseISO(dateIso);
    return (
      (dateIso === todayIso ? "오늘 · " : "") +
      (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + WEEKDAYS[d.getDay()] + ")"
    );
  }

  return {
    DAY_MS: DAY_MS,
    MAX_AMOUNT: MAX_AMOUNT,
    DELETED_CATEGORY: DELETED_CATEGORY,
    pad2: pad2,
    todayISO: todayISO,
    isISODate: isISODate,
    parseISO: parseISO,
    diffDays: diffDays,
    addDays: addDays,
    daysLeft: daysLeft,
    budgetStatus: budgetStatus,
    monthBounds: monthBounds,
    monthLabel: monthLabel,
    addMonths: addMonths,
    monthGrid: monthGrid,
    indexByDate: indexByDate,
    isPersonal: isPersonal,
    effectiveBudget: effectiveBudget,
    budgetExpenses: budgetExpenses,
    floorTo100: floorTo100,
    clamp: clamp,
    isValidAmount: isValidAmount,
    parseAmount: parseAmount,
    pressKey: pressKey,
    formatWon: formatWon,
    sumAmount: sumAmount,
    expensesOfBudget: expensesOfBudget,
    computeBudgetStats: computeBudgetStats,
    computeDayStats: computeDayStats,
    shortDate: shortDate,
    categoryShares: categoryShares,
    groupByDate: groupByDate,
    findCategory: findCategory,
    resolveCategory: resolveCategory,
    sortCategoriesByUsage: sortCategoriesByUsage,
    UNKNOWN_MEMBER: UNKNOWN_MEMBER,
    memberName: memberName,
    memberNames: memberNames,
    memberInitials: memberInitials,
    memberShares: memberShares,
    settlement: settlement,
    periodLabel: periodLabel,
    dayLabel: dayLabel
  };
});
