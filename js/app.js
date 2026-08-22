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
    viewId: null,
    selMode: false,
    selected: [],
    swipedId: null,
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

  function chipStyle(on) {
    return (
      "white-space:nowrap;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:600;border:1px solid " +
      (on ? "var(--fg)" : "var(--g2)") +
      ";background:" + (on ? "var(--fg)" : "transparent") +
      ";color:" + (on ? "var(--bg)" : "var(--g3)")
    );
  }

  function checkStyle(checked) {
    return (
      "flex:0 0 auto;width:22px;height:22px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:1px solid " +
      (checked ? "var(--fg)" : "var(--g2)") +
      ";background:" + (checked ? "var(--fg)" : "transparent") + ";color:var(--bg)"
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

    show("selMode", ui.selMode);
    show("notSelMode", !ui.selMode);

    if (ui.snack) text("snackText", ui.snack.text);

    if (active) renderHome(active);
    renderView();
    renderAdd(active);
    renderBudgetSheet();
    renderBudgetList();
    renderCats();
  }

  /* 내역/요약이 바라보는 예산 */
  function viewBudget() {
    return findBudget(ui.viewId) || activeBudget();
  }

  function chipsHTML(selectedId) {
    return data.budgets
      .map(function (b) {
        return (
          '<button data-act="selectView" data-id="' + esc(b.id) + '" style="' + chipStyle(b.id === selectedId) + '">' +
          esc(b.name + " " + calc.periodLabel(b)) + "</button>"
        );
      })
      .join("");
  }

  function renderView() {
    if (ui.tab !== "history" && ui.tab !== "summary") return;
    var view = viewBudget();
    if (!view) return;

    var list = calc.expensesOfBudget(data.expenses, view.id);
    var spent = calc.sumAmount(list);

    html(el("budgetChips"), chipsHTML(view.id));
    html(el("budgetChipsSummary"), chipsHTML(view.id));

    var periodText = view.name + " " + calc.periodLabel(view);
    text("viewPeriodText", periodText);
    text("viewPeriodText2", periodText);
    text("viewSpentText", calc.formatWon(spent));
    text("viewSpentText2", calc.formatWon(spent));
    text("viewTotalText", calc.formatWon(view.totalAmount));
    text("selCountText", ui.selected.length + "개 선택됨");

    show("viewEmpty", list.length === 0);
    show("hasRows", list.length > 0);

    if (ui.tab === "history") renderGroups(list);
    else renderSummary(view, list, spent);
  }

  function renderGroups(list) {
    var groups = calc.groupByDate(list);
    html(
      el("groups"),
      groups
        .map(function (g) {
          return (
            '<div style="padding-bottom:18px">' +
              '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 4px">' +
                '<div style="font-size:12px;font-weight:700;color:var(--g3)">' + esc(calc.dayLabel(g.date, today)) + "</div>" +
                '<div style="font-size:12px;color:var(--g3)">' + esc(calc.formatWon(g.sum)) + "원</div>" +
              "</div>" +
              g.items.map(swipeRowHTML).join("") +
            "</div>"
          );
        })
        .join("")
    );
    paintRows();
  }

  function swipeRowHTML(e) {
    var c = calc.resolveCategory(e, data.categories);
    return (
      '<div style="position:relative;overflow:hidden;border-top:1px solid var(--g1)">' +
        '<div style="position:absolute;inset:0;display:flex;justify-content:flex-end">' +
          '<button data-act="editExpense" data-id="' + esc(e.id) + '" style="width:70px;border:none;background:var(--g1);font-size:13px;font-weight:600">수정</button>' +
          '<button data-act="removeExpense" data-id="' + esc(e.id) + '" style="width:70px;border:none;background:var(--fg);color:var(--bg);font-size:13px;font-weight:600">삭제</button>' +
        "</div>" +
        '<div data-row="' + esc(e.id) + '" class="mm-row" style="position:relative;display:flex;align-items:center;gap:12px;padding:13px 2px;background:var(--bg);transition:transform .18s ease;touch-action:pan-y;cursor:pointer">' +
          (ui.selMode ? '<div data-check="' + esc(e.id) + '"></div>' : "") +
          '<div style="font-size:20px;width:26px;text-align:center">' + esc(c.emoji) + "</div>" +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:600">' + esc(c.name) + "</div>" +
            (e.memo
              ? '<div style="font-size:12px;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</div>"
              : "") +
          "</div>" +
          '<div style="font-size:16px;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</div>" +
        "</div>" +
      "</div>"
    );
  }

  /* 스와이프 위치와 체크 표시는 마크업을 다시 만들지 않고 직접 칠한다
     (그래야 transition이 살아 있고, 탭할 때마다 목록이 통째로 다시 그려지지 않는다) */
  function paintRows() {
    var rows = document.querySelectorAll("[data-row]");
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute("data-row");
      var open = !ui.selMode && ui.swipedId === id;
      rows[i].style.transform = open ? "translateX(-140px)" : "translateX(0)";
    }
    var checks = document.querySelectorAll("[data-check]");
    for (var j = 0; j < checks.length; j++) {
      var cid = checks[j].getAttribute("data-check");
      var on = ui.selected.indexOf(cid) >= 0;
      checks[j].style.cssText = checkStyle(on);
      checks[j].textContent = on ? "✓" : "";
    }
  }

  function renderSummary(view, list, spent) {
    var pct = view.totalAmount > 0 ? (spent / view.totalAmount) * 100 : 0;
    text("usedPctText", Math.round(pct) + "%");
    css(
      "donut",
      "position:relative;width:196px;height:196px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(var(--fg) 0 " +
        Math.min(100, pct).toFixed(2) + "%, var(--g1) 0)"
    );

    html(
      el("shares"),
      calc
        .categoryShares(list, data.categories)
        .map(function (sh) {
          return (
            '<div style="padding-bottom:16px">' +
              '<div style="display:flex;align-items:center;gap:8px;padding-bottom:6px">' +
                '<div style="font-size:16px">' + esc(sh.emoji) + "</div>" +
                '<div style="flex:1;font-size:13px;font-weight:600">' + esc(sh.name) + "</div>" +
                '<div style="font-size:12px;color:var(--g3)">' + sh.pct.toFixed(0) + "%</div>" +
                '<div style="font-size:13px;font-weight:700;min-width:66px;text-align:right">' + esc(calc.formatWon(sh.amount)) + "원</div>" +
              "</div>" +
              '<div style="height:8px;border-radius:4px;background:var(--g1);overflow:hidden">' +
                '<div style="height:100%;width:' + sh.pct.toFixed(2) + '%;background:var(--fg)"></div>' +
              "</div>" +
            "</div>"
          );
        })
        .join("")
    );
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

  function renderBudgetList() {
    if (!ui.budgetOpen) return;
    html(
      el("budgetList"),
      data.budgets
        .map(function (b) {
          var st = calc.computeBudgetStats(b, data.expenses, today);
          var state =
            b.id === data.settings.activeBudgetId ? "사용 중" :
            st.status === "ended" ? "종료" : "대기";
          return (
            '<div style="display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--g1)">' +
              '<button data-act="activateBudget" data-id="' + esc(b.id) + '" style="flex:1;min-width:0;text-align:left;border:none;background:none;padding:0">' +
                '<div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.name) + "</div>" +
                '<div style="font-size:11px;color:var(--g3);margin-top:3px">' +
                  esc(calc.periodLabel(b) + " · " + calc.formatWon(st.spent) + " / " + calc.formatWon(b.totalAmount)) + "원</div>" +
              "</button>" +
              '<div style="font-size:11px;color:var(--g3);flex:0 0 auto">' + state + "</div>" +
              '<button data-act="removeBudget" data-id="' + esc(b.id) + '" style="border:none;background:none;padding:0 2px;font-size:12px;color:var(--g3);flex:0 0 auto">삭제</button>' +
            "</div>"
          );
        })
        .join("")
    );
  }

  function renderCats() {
    if (!ui.catsOpen) return;

    // 값(value)은 마크업에 넣지 않는다 -> 타이핑해도 목록이 다시 그려지지 않아 포커스가 유지된다
    html(
      el("catList"),
      data.categories
        .map(function (c) {
          return (
            '<div data-cat="' + esc(c.id) + '" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--g1)">' +
              '<input data-catfield="emoji" data-id="' + esc(c.id) + '" maxlength="4" style="width:40px;flex:0 0 auto;border:none;font-size:19px;text-align:center;outline:none" />' +
              '<input data-catfield="name" data-id="' + esc(c.id) + '" maxlength="20" style="flex:1;min-width:0;border:none;font-size:14px;font-weight:600;outline:none" />' +
              '<button data-act="catUp" data-id="' + esc(c.id) + '" style="width:30px;height:30px;flex:0 0 auto;border:1px solid var(--g2);border-radius:8px;background:none;font-size:11px">↑</button>' +
              '<button data-act="catDown" data-id="' + esc(c.id) + '" style="width:30px;height:30px;flex:0 0 auto;border:1px solid var(--g2);border-radius:8px;background:none;font-size:11px">↓</button>' +
              '<button data-act="catRemove" data-id="' + esc(c.id) + '" style="width:30px;height:30px;flex:0 0 auto;border:none;background:none;font-size:12px;color:var(--g3)">✕</button>' +
            "</div>"
          );
        })
        .join("")
    );

    data.categories.forEach(function (c) {
      var row = document.querySelector('[data-cat="' + c.id + '"]');
      if (!row) return;
      value(row.querySelector('[data-catfield="emoji"]'), c.emoji);
      value(row.querySelector('[data-catfield="name"]'), c.name);
    });

    var canAdd = !!(el("newCatName").value || "").trim();
    var addBtn = el("addCat");
    addBtn.disabled = !canAdd;
    addBtn.style.cssText =
      "width:56px;flex:0 0 auto;border:none;border-radius:10px;font-size:14px;font-weight:700;background:" +
      (canAdd ? "var(--fg)" : "var(--g1)") + ";color:" + (canAdd ? "var(--bg)" : "var(--g3)");
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

  function enterSelWith(id) {
    ui.selMode = true;
    ui.swipedId = null;
    ui.selected = id ? [id] : [];
    render();
  }

  function toggleSel(id) {
    var i = ui.selected.indexOf(id);
    if (i >= 0) ui.selected.splice(i, 1);
    else ui.selected.push(id);
    paintRows();
    text("selCountText", ui.selected.length + "개 선택됨");
  }

  function removeMany(ids, label) {
    if (!ids.length) return;
    var gone = data.expenses.filter(function (e) {
      return ids.indexOf(e.id) >= 0;
    });
    data = store.update(function (draft) {
      draft.expenses = draft.expenses.filter(function (e) {
        return ids.indexOf(e.id) < 0;
      });
    });
    ui.selMode = false;
    ui.selected = [];
    ui.swipedId = null;
    snack((label || ids.length + "건 삭제됨"), function () {
      data = store.update(function (draft) {
        draft.expenses = gone.concat(draft.expenses);
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
    ui.viewId = b.id;
    ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
    render();
  }

  function moveCat(id, dir) {
    data = store.update(function (draft) {
      var i = -1;
      for (var k = 0; k < draft.categories.length; k++) if (draft.categories[k].id === id) i = k;
      var j = i + dir;
      if (i < 0 || j < 0 || j >= draft.categories.length) return;
      var tmp = draft.categories[i];
      draft.categories[i] = draft.categories[j];
      draft.categories[j] = tmp;
      draft.categories.forEach(function (c, n) { c.order = n; });
    });
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
    removeExpense: function (node) {
      removeExpense(node.getAttribute("data-id"));
    },

    goHome: function () { ui.tab = "home"; ui.swipedId = null; ui.selMode = false; ui.selected = []; render(); },
    goHistory: function () {
      ui.tab = "history";
      if (!findBudget(ui.viewId)) ui.viewId = data.settings.activeBudgetId;
      ui.selMode = false; ui.selected = []; ui.swipedId = null;
      render();
    },
    goSummary: function () {
      ui.tab = "summary";
      if (!findBudget(ui.viewId)) ui.viewId = data.settings.activeBudgetId;
      render();
    },
    selectView: function (node) {
      ui.viewId = node.getAttribute("data-id");
      ui.selMode = false; ui.selected = []; ui.swipedId = null;
      render();
    },

    enterSel: function () { enterSelWith(null); },
    exitSel: function () { ui.selMode = false; ui.selected = []; render(); },
    selectAll: function () {
      var view = viewBudget();
      if (!view) return;
      ui.selected = calc.expensesOfBudget(data.expenses, view.id).map(function (e) { return e.id; });
      paintRows();
      text("selCountText", ui.selected.length + "개 선택됨");
    },
    deleteSelected: function () { removeMany(ui.selected.slice()); },

    deleteAllFromMenu: function () {
      var view = viewBudget();
      ui.menuOpen = false;
      if (!view) { render(); return; }
      var ids = calc.expensesOfBudget(data.expenses, view.id).map(function (e) { return e.id; });
      if (!ids.length) {
        render();
        snack("지울 내역이 없습니다", null);
        render();
        return;
      }
      if (!confirm('"' + view.name + '" 예산의 지출 ' + ids.length + "건을 모두 지웁니다.\n\n계속할까요?")) {
        render();
        return;
      }
      removeMany(ids, ids.length + "건 삭제됨");
    },

    activateBudget: function (node) {
      var id = node.getAttribute("data-id");
      data = store.update(function (draft) { draft.settings.activeBudgetId = id; });
      ui.viewId = id;
      ui.budgetOpen = false;
      ui.tab = "home";
      render();
    },
    removeBudget: function (node) {
      var id = node.getAttribute("data-id");
      var b = findBudget(id);
      if (!b) return;
      var n = data.expenses.filter(function (e) { return e.budgetId === id; }).length;
      var msg = '"' + b.name + '" 예산을 지웁니다.\n' +
        (n > 0 ? "이 예산에 기록한 지출 " + n + "건도 함께 삭제됩니다.\n" : "") +
        "\n되돌릴 수 없습니다. 계속할까요?";
      if (!confirm(msg)) return;
      data = store.update(function (draft) {
        draft.budgets = draft.budgets.filter(function (x) { return x.id !== id; });
        draft.expenses = draft.expenses.filter(function (e) { return e.budgetId !== id; });
        if (draft.settings.activeBudgetId === id) {
          draft.settings.activeBudgetId = draft.budgets.length ? draft.budgets[0].id : null;
        }
      });
      if (ui.viewId === id) ui.viewId = data.settings.activeBudgetId;
      render();
    },

    openCats: function () { ui.menuOpen = false; ui.catsOpen = true; render(); },
    closeCats: function () { ui.catsOpen = false; render(); },
    addCat: function () {
      var nameInput = el("newCatName");
      var emojiInput = el("newCatEmoji");
      var name = (nameInput.value || "").trim();
      if (!name) return;
      var emoji = (emojiInput.value || "").trim() || "✏️";
      data = store.update(function (draft) {
        draft.categories.push({
          id: store.uid(),
          name: name,
          emoji: emoji,
          order: draft.categories.length,
          isDefault: false
        });
      });
      nameInput.value = "";
      emojiInput.value = "";
      render();
    },
    catUp: function (node) { moveCat(node.getAttribute("data-id"), -1); },
    catDown: function (node) { moveCat(node.getAttribute("data-id"), 1); },
    catRemove: function (node) {
      var id = node.getAttribute("data-id");
      var c = calc.findCategory(data.categories, id);
      if (!c) return;
      if (data.categories.length <= 1) {
        alert("카테고리는 최소 하나는 있어야 합니다.");
        return;
      }
      var n = store.categoryUsageCount(data, id);
      var msg = '"' + c.name + '" 카테고리를 지웁니다.\n' +
        (n > 0 ? "이 카테고리로 기록한 지출 " + n + "건은 그대로 남고, 이름도 계속 보입니다.\n" : "") +
        "\n계속할까요?";
      if (!confirm(msg)) return;
      data = store.update(function (draft) { store.deleteCategory(draft, id); });
      render();
    },

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

  /* 카테고리 이름/이모지 인라인 수정 */
  document.addEventListener("input", function (ev) {
    var node = ev.target;
    if (!node.getAttribute) return;

    var field = node.getAttribute("data-catfield");
    if (field) {
      var id = node.getAttribute("data-id");
      var v = node.value;
      data = store.update(function (draft) {
        draft.categories.forEach(function (c) {
          if (c.id !== id) return;
          if (field === "name") c.name = v;
          else c.emoji = v;
        });
      });
      return; // 목록을 다시 그리지 않는다 (포커스 유지)
    }

    if (node.getAttribute("data-el") === "newCatName") renderCats();
  });

  /* 이름을 비운 채 포커스를 옮기면 원래 이름으로 되돌린다 */
  document.addEventListener("blur", function (ev) {
    var node = ev.target;
    if (!node.getAttribute || !node.getAttribute("data-catfield")) return;
    if ((node.value || "").trim()) return;
    data = store.load();
    render();
  }, true);

  /* ---------- 스와이프 / 길게 눌러 선택 ---------- */

  var touch = { id: null, x: 0, y: 0, moved: false, timer: null, longFired: false };

  function clearTouch() {
    clearTimeout(touch.timer);
    touch.id = null;
    touch.longFired = false;
  }

  document.addEventListener("pointerdown", function (ev) {
    var row = ev.target.closest ? ev.target.closest("[data-row]") : null;
    if (!row) return;
    touch.id = row.getAttribute("data-row");
    touch.x = ev.clientX;
    touch.y = ev.clientY;
    touch.moved = false;
    touch.longFired = false;
    clearTimeout(touch.timer);
    touch.timer = setTimeout(function () {
      if (touch.moved || !touch.id) return;
      touch.longFired = true;
      enterSelWith(touch.id);
    }, 450);
  });

  document.addEventListener("pointermove", function (ev) {
    if (!touch.id) return;
    if (Math.abs(ev.clientX - touch.x) > 8 || Math.abs(ev.clientY - touch.y) > 8) {
      touch.moved = true;
      clearTimeout(touch.timer);
    }
  });

  document.addEventListener("pointerup", function (ev) {
    if (!touch.id) return;
    var id = touch.id;
    var dx = ev.clientX - touch.x;
    var dy = ev.clientY - touch.y;
    var moved = touch.moved;
    var long = touch.longFired;
    clearTouch();
    if (long) return;

    if (ui.selMode) {
      if (!moved) toggleSel(id);
      return;
    }

    // 가로로 충분히 끌었으면 스와이프
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
      ui.swipedId = dx < 0 ? id : null;
      paintRows();
      return;
    }

    if (moved) return;

    // 열린 스와이프가 있으면 탭은 닫기로만 쓴다
    if (ui.swipedId) {
      ui.swipedId = null;
      paintRows();
      return;
    }
    editExpense(id);
  });

  document.addEventListener("pointercancel", clearTouch);

  /* 길게 눌렀을 때 iOS의 복사 메뉴 대신 선택 모드로 */
  document.addEventListener("contextmenu", function (ev) {
    var row = ev.target.closest ? ev.target.closest("[data-row]") : null;
    if (!row) return;
    ev.preventDefault();
    enterSelWith(row.getAttribute("data-row"));
  });

  /* 다른 탭에서 데이터가 바뀌면 반영 */
  store.subscribe(function (next) {
    data = next;
    if (!findBudget(ui.viewId)) ui.viewId = data.settings.activeBudgetId;
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

  ui.viewId = data.settings.activeBudgetId;
  render();

  /* 오프라인 지원. file://로 열었을 땐 서비스 워커를 쓸 수 없으므로 건너뛴다. */
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
