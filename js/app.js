/* app.js — 화면 렌더링 + 이벤트.
   디자인의 마크업/스타일 문자열을 그대로 재현하고, 값만 계산해서 꽂는다. */
(function () {
  "use strict";

  var calc = MP.calc;
  var store = MP.store;

  /* ---------- 상태 ---------- */

  var data = store.load();
  var today = calc.todayISO();

  var ui = {
    tab: "home",
    addOpen: false,
    budgetOpen: false,
    catsOpen: false,
    menuOpen: false,
    snack: null,
    snackTimer: null,
    draft: { amount: 0, categoryId: null, memo: "", date: today, editingId: null },
    nb: { name: "", start: today, end: calc.addDays(today, 6), total: "" }
  };

  /* ---------- DOM 헬퍼 ---------- */

  function el(name) {
    return document.querySelector('[data-el="' + name + '"]');
  }

  function show(name, cond) {
    var list = document.querySelectorAll('[data-show="' + name + '"]');
    for (var i = 0; i < list.length; i++) list[i].classList.toggle("mm-hide", !cond);
  }

  function text(name, value) {
    var node = el(name);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function css(name, value) {
    var node = el(name);
    if (node && node.style.cssText !== value) node.style.cssText = value;
  }

  /** innerHTML은 같은 내용이면 건너뛴다 (입력 중 깜빡임/포커스 손실 방지) */
  function html(node, markup) {
    if (!node) return;
    if (node.__mm === markup) return;
    node.__mm = markup;
    node.innerHTML = markup;
  }

  /** 사용자가 타이핑 중인 입력은 건드리지 않는다 */
  function value(node, v) {
    if (!node || document.activeElement === node) return;
    if (node.value !== v) node.value = v;
  }

  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }

  /**
   * 큰 금액이 화면 밖으로 넘칠 때만 글자를 줄인다.
   * 평소에는 디자인 크기 그대로.
   */
  function fit(node, sibling, basePx, gapPx) {
    if (!node) return;
    node.style.fontSize = basePx + "px";
    var row = node.parentNode;
    if (!row || !row.clientWidth) return; // 숨겨진 상태면 측정 불가
    var avail = row.clientWidth - (sibling ? sibling.offsetWidth : 0) - (gapPx || 0);
    var want = node.scrollWidth;
    if (avail > 0 && want > avail) {
      node.style.fontSize = Math.max(11, Math.floor(basePx * (avail / want))) + "px";
    }
  }

  /* ---------- 데이터 조회 ---------- */

  function findBudget(id) {
    for (var i = 0; i < data.budgets.length; i++) {
      if (data.budgets[i].id === id) return data.budgets[i];
    }
    return null;
  }

  function activeBudget() {
    return findBudget(data.settings.activeBudgetId);
  }

  /* ---------- 스낵바 ---------- */

  function snack(message, undo) {
    clearTimeout(ui.snackTimer);
    ui.snack = { text: message, undo: undo || null };
    ui.snackTimer = setTimeout(function () {
      ui.snack = null;
      render();
    }, 3000);
  }

  function hideSnack() {
    clearTimeout(ui.snackTimer);
    ui.snack = null;
  }

  /* ---------- 디자인의 동적 스타일 문자열 ---------- */

  var STRIPES = "repeating-linear-gradient(115deg, var(--fg) 0 6px, var(--g3) 6px 11px)";

  function tabStyle(name) {
    var on = ui.tab === name;
    return (
      "border:none;background:none;min-height:46px;padding:10px 2px 12px;font-size:17px;letter-spacing:-.02em;font-weight:" +
      (on ? "800" : "500") +
      ";color:" + (on ? "var(--fg)" : "var(--g3)") +
      ";border-bottom:2px solid " + (on ? "var(--fg)" : "transparent")
    );
  }

  function catButtonStyle(selected) {
    return (
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:clamp(42px,6.4dvh,60px);border-radius:12px;padding:2px;border:1px solid " +
      (selected ? "var(--fg)" : "var(--g2)") +
      ";background:" + (selected ? "var(--fg)" : "transparent") +
      ";color:" + (selected ? "var(--bg)" : "var(--fg)")
    );
  }

  /* ---------- 렌더 ---------- */

  var KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

  function expenseRowHTML(e) {
    var c = calc.resolveCategory(e, data.categories);
    return (
      '<div data-act="editExpense" data-id="' + esc(e.id) + '" style="display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--g1);cursor:pointer">' +
        '<div style="font-size:20px;width:26px;text-align:center">' + esc(c.emoji) + "</div>" +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:600">' + esc(c.name) + "</div>" +
          (e.memo
            ? '<div style="font-size:12px;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</div>"
            : "") +
        "</div>" +
        '<div style="font-size:16px;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</div>" +
      "</div>"
    );
  }

  function render() {
    var active = activeBudget();

    document.documentElement.dataset.mm = data.settings.theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", data.settings.theme === "dark" ? "#0a0a0a" : "#ffffff");

    show("noBudget", !active);
    show("hasBudget", !!active);
    show("isHome", !!active && ui.tab === "home");
    show("isHistory", !!active && ui.tab === "history");
    show("isSummary", !!active && ui.tab === "summary");
    show("addOpen", ui.addOpen);
    show("menuOpen", ui.menuOpen);
    show("budgetOpen", ui.budgetOpen);
    show("catsOpen", ui.catsOpen);
    show("snackOpen", !!ui.snack);
    show("editing", !!ui.draft.editingId);

    css("tabHome", tabStyle("home"));
    css("tabHistory", tabStyle("history"));
    css("tabSummary", tabStyle("summary"));
    text("themeLabel", data.settings.theme === "dark" ? "라이트" : "다크");

    if (ui.snack) text("snackText", ui.snack.text);

    if (active) renderHome(active);
    renderAdd(active);
    renderBudgetSheet();
  }

  function renderHome(active) {
    var s = calc.computeBudgetStats(active, data.expenses, today);

    text("remainingText", calc.formatWon(s.remaining));
    text("spentText", calc.formatWon(s.spent));
    text("totalText", calc.formatWon(s.total));

    css(
      "gauge",
      "height:100%;width:" + s.spentPct.toFixed(2) + "%;background:" +
        (s.overToday ? STRIPES : "var(--fg)") + ";transition:width .3s ease"
    );

    // 기간이 끝나면 일일 권장액은 숨긴다 (자리는 그대로, 값만 —)
    text("perDayText", s.ended ? "—" : calc.formatWon(s.perDay));
    text("todaySpentText", calc.formatWon(s.todaySpent));
    text("daysLeftText", s.ended ? "기간 종료 · 새 예산을 만들어 주세요" : "남은 기간 " + s.daysLeft + "일");

    var todays = calc.expensesOfBudget(data.expenses, active.id).filter(function (e) {
      return e.date === today;
    });
    show("todayEmpty", todays.length === 0);
    html(el("todayList"), todays.map(expenseRowHTML).join(""));

    fit(el("remainingText"), el("remainingWon"), 56, 4);
    fit(el("perDayText"), el("perDayWon"), 24, 3);
    fit(el("todaySpentText"), el("todaySpentWon"), 24, 3);
  }

  function renderAdd(active) {
    if (!ui.addOpen) return;

    var d = ui.draft;

    value(el("draftDate"), d.date);
    var dateInput = el("draftDate");
    if (dateInput && active) {
      // 이 예산 기간 안에서만 고를 수 있게 (기간 밖 지출이 합계에 섞이는 혼란 방지)
      dateInput.min = active.startDate;
      dateInput.max = active.endDate;
    }

    css(
      "draftAmountText",
      "font-weight:800;letter-spacing:-.045em;line-height:1.05;color:" + (d.amount ? "var(--fg)" : "var(--g2)")
    );
    text("draftAmountText", calc.formatWon(d.amount));
    value(el("draftMemo"), d.memo);

    var ordered = calc.sortCategoriesByUsage(data.categories, data.expenses, today);
    html(
      el("catGrid"),
      ordered
        .map(function (c) {
          return (
            '<button data-act="pickCat" data-id="' + esc(c.id) + '" style="' + catButtonStyle(d.categoryId === c.id) + '">' +
              '<div style="font-size:21px;line-height:1.1">' + esc(c.emoji) + "</div>" +
              '<div style="font-size:9.5px;font-weight:600;line-height:1.15;text-align:center;word-break:keep-all">' + esc(c.name) + "</div>" +
            "</button>"
          );
        })
        .join("")
    );

    html(
      el("keys"),
      KEYPAD.map(function (k) {
        return (
          '<button data-act="key" data-key="' + esc(k) +
          '" style="height:clamp(34px,6.6dvh,58px);border:none;background:none;font-size:24px;font-weight:600;border-radius:12px">' +
          esc(k) + "</button>"
        );
      }).join("")
    );

    var canSave = calc.isValidAmount(d.amount) && !!d.categoryId;
    var saveBtn = el("save");
    saveBtn.disabled = !canSave;
    saveBtn.style.cssText =
      "flex:1;height:clamp(44px,7dvh,56px);border:none;border-radius:14px;font-size:17px;font-weight:700;background:" +
      (canSave ? "var(--fg)" : "var(--g1)") + ";color:" + (canSave ? "var(--bg)" : "var(--g3)");

    var base = Math.min(50, Math.max(30, window.innerHeight * 0.06)); // clamp(30px,6dvh,50px)
    fit(el("draftAmountText"), el("draftAmountWon"), base, 5);
  }

  function renderBudgetSheet() {
    if (!ui.budgetOpen) return;
    value(el("nbName"), ui.nb.name);
    value(el("nbStart"), ui.nb.start);
    value(el("nbEnd"), ui.nb.end);
    value(el("nbTotal"), ui.nb.total);

    var total = calc.parseAmount(ui.nb.total);
    var ok = calc.isValidAmount(total) &&
      calc.isISODate(ui.nb.start) && calc.isISODate(ui.nb.end) &&
      ui.nb.end >= ui.nb.start;

    var btn = el("createBudget");
    btn.disabled = !ok;
    btn.style.cssText =
      "margin-top:16px;width:100%;height:52px;border:none;border-radius:13px;font-size:16px;font-weight:700;background:" +
      (ok ? "var(--fg)" : "var(--g1)") + ";color:" + (ok ? "var(--bg)" : "var(--g3)");
  }

  /* ---------- 동작 ---------- */

  function openAdd() {
    ui.draft = { amount: 0, categoryId: null, memo: "", date: today, editingId: null };
    ui.addOpen = true;
    hideSnack();
    render();
  }

  function editExpense(id) {
    var e = null;
    for (var i = 0; i < data.expenses.length; i++) if (data.expenses[i].id === id) e = data.expenses[i];
    if (!e) return;
    ui.draft = {
      amount: e.amount,
      categoryId: e.categoryId,
      memo: e.memo,
      date: e.date,
      editingId: e.id
    };
    ui.addOpen = true;
    hideSnack();
    render();
  }

  function closeAdd() {
    ui.addOpen = false;
    ui.draft.editingId = null;
    render();
  }

  function saveExpense() {
    var d = ui.draft;
    if (!calc.isValidAmount(d.amount) || !d.categoryId) return;

    if (d.editingId) {
      var id = d.editingId;
      data = store.update(function (draft) {
        draft.expenses.forEach(function (e) {
          if (e.id !== id) return;
          e.amount = d.amount;
          e.categoryId = d.categoryId;
          e.memo = d.memo;
          e.date = d.date;
          // 살아 있는 카테고리를 다시 고르면 옛 이름 스냅샷은 지운다
          delete e.categoryName;
          delete e.categoryEmoji;
        });
      });
      ui.addOpen = false;
      ui.draft.editingId = null;
      snack("수정됨", null);
      render();
      return;
    }

    var created = {
      id: store.uid(),
      budgetId: data.settings.activeBudgetId,
      amount: d.amount,
      categoryId: d.categoryId,
      memo: d.memo,
      date: d.date,
      createdAt: Date.now()
    };
    data = store.update(function (draft) {
      draft.expenses.unshift(created);
    });
    ui.addOpen = false;
    ui.tab = "home";

    var c = calc.resolveCategory(created, data.categories);
    snack(calc.formatWon(created.amount) + "원 · " + c.name + " 저장", function () {
      data = store.update(function (draft) {
        draft.expenses = draft.expenses.filter(function (e) {
          return e.id !== created.id;
        });
      });
    });
    render();
  }

  function removeExpense(id) {
    var gone = null;
    for (var i = 0; i < data.expenses.length; i++) if (data.expenses[i].id === id) gone = data.expenses[i];
    if (!gone) return;
    data = store.update(function (draft) {
      draft.expenses = draft.expenses.filter(function (e) {
        return e.id !== id;
      });
    });
    ui.addOpen = false;
    ui.draft.editingId = null;
    snack("삭제됨", function () {
      data = store.update(function (draft) {
        draft.expenses.unshift(gone);
      });
    });
    render();
  }

  function createBudget() {
    var total = calc.parseAmount(ui.nb.total);
    if (!calc.isValidAmount(total)) return;
    if (!calc.isISODate(ui.nb.start) || !calc.isISODate(ui.nb.end)) return;
    if (ui.nb.end < ui.nb.start) return;

    var b = {
      id: store.uid(),
      name: (ui.nb.name || "").trim() || "예산",
      startDate: ui.nb.start,
      endDate: ui.nb.end,
      totalAmount: total,
      createdAt: Date.now()
    };
    data = store.update(function (draft) {
      draft.budgets.unshift(b);
      draft.settings.activeBudgetId = b.id;
    });
    ui.budgetOpen = false;
    ui.tab = "home";
    ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
    render();
  }

  /* ---------- 이벤트 ---------- */

  var ACTIONS = {
    openAdd: openAdd,
    closeAdd: closeAdd,
    save: saveExpense,
    editExpense: function (node) {
      editExpense(node.getAttribute("data-id"));
    },
    deleteEditing: function () {
      if (ui.draft.editingId) removeExpense(ui.draft.editingId);
    },
    pickCat: function (node) {
      ui.draft.categoryId = node.getAttribute("data-id");
      render();
    },
    key: function (node) {
      ui.draft.amount = calc.pressKey(ui.draft.amount, node.getAttribute("data-key"));
      render();
    },
    undo: function () {
      var fn = ui.snack && ui.snack.undo;
      hideSnack();
      if (fn) fn();
      render();
    },
    openMenu: function () {
      ui.menuOpen = true;
      render();
    },
    closeMenu: function () {
      ui.menuOpen = false;
      render();
    },
    openBudget: function () {
      ui.menuOpen = false;
      ui.budgetOpen = true;
      ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
      render();
    },
    closeBudget: function () {
      ui.budgetOpen = false;
      render();
    },
    createBudget: createBudget,
    toggleTheme: function () {
      var next = data.settings.theme === "dark" ? "light" : "dark";
      data = store.update(function (draft) {
        draft.settings.theme = next;
      });
      ui.menuOpen = false;
      render();
    }
  };

  document.addEventListener("click", function (ev) {
    var node = ev.target.closest("[data-act]");
    if (!node) return;
    if (node.disabled) return;
    var fn = ACTIONS[node.getAttribute("data-act")];
    if (!fn) return;
    ev.preventDefault();
    fn(node);
  });

  document.addEventListener("input", function (ev) {
    var node = ev.target;
    var name = node.getAttribute && node.getAttribute("data-el");
    if (!name) return;
    if (name === "draftMemo") ui.draft.memo = node.value;
    else if (name === "draftDate") ui.draft.date = calc.isISODate(node.value) ? node.value : today;
    else if (name === "nbName") ui.nb.name = node.value;
    else if (name === "nbStart") { ui.nb.start = node.value; renderBudgetSheet(); }
    else if (name === "nbEnd") { ui.nb.end = node.value; renderBudgetSheet(); }
    else if (name === "nbTotal") {
      var n = calc.parseAmount(node.value);
      ui.nb.total = n ? calc.formatWon(n) : "";
      node.value = ui.nb.total;
      renderBudgetSheet();
    } else return;

    if (name === "draftMemo" || name === "draftDate") renderAdd(activeBudget());
  });

  /* 다른 탭에서 데이터가 바뀌면 반영 */
  store.subscribe(function (next) {
    data = next;
    render();
  });

  /* 자정이 지나면 날짜와 계산을 갱신 */
  function checkDate() {
    var now = calc.todayISO();
    if (now === today) return;
    today = now;
    if (!ui.draft.editingId && !ui.addOpen) ui.draft.date = today;
    render();
  }
  setInterval(checkDate, 30000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      data = store.load();
      checkDate();
      render();
    }
  });
  window.addEventListener("focus", checkDate);

  /* 화면 크기가 바뀌면 큰 숫자 맞춤을 다시 계산 */
  window.addEventListener("resize", function () {
    render();
  });

  render();
})();
