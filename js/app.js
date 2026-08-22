/* app.js — 화면 렌더링 + 이벤트.
   디자인의 마크업/스타일 문자열을 그대로 재현하고, 값만 계산해서 꽂는다.
   데이터는 store(=Firestore)가 들고 있고, 로그인 상태는 auth가 들고 있다. */
(function () {
  "use strict";

  var calc = MP.calc;
  var model = MP.model;
  var store = MP.store;
  var auth = MP.auth;

  /* ---------- 상태 ---------- */

  var data = store.get();
  var today = calc.todayISO();
  var uiTheme = store.bootTheme();
  var legacyAsked = false;

  var ui = {
    tab: "home",
    selMode: false,
    selected: [],
    swipedId: null,
    addOpen: false,
    budgetOpen: false,
    catsOpen: false,
    shareOpen: false,
    menuOpen: false,
    switcherOpen: false,
    personalOpen: false,
    historyView: "list",   // "list" | "calendar"
    calMonth: today,        // 달력이 보고 있는 달
    dayOpen: null,          // 팝업으로 연 날짜

    snack: null,
    snackTimer: null,
    updateReady: false,
    draft: { amount: 0, categoryId: null, memo: "", date: today, editingId: null },
    nb: { name: "", start: today, end: calc.addDays(today, 6), total: "" },
    pb: { total: "", mode: "month", start: today, end: today },
    auth: { mode: "login", email: "", password: "", name: "", error: "", busy: false },
    share: { code: "", error: "", busy: false }
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

  function disable(node, off, onStyle, offStyle) {
    if (!node) return;
    node.disabled = off;
    var next = off ? offStyle : onStyle;
    if (node.style.cssText !== next) node.style.cssText = next;
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

  function me() {
    return auth.user() || { uid: "", name: "", email: "" };
  }

  function signedIn() {
    return auth.state().status === "signed-in";
  }

  function appReady() {
    return signedIn() && store.ready();
  }

  function findBudget(id) {
    for (var i = 0; i < data.budgets.length; i++) {
      if (data.budgets[i].id === id) return data.budgets[i];
    }
    return null;
  }

  function activeBudget() {
    return findBudget(data.settings.activeBudgetId);
  }

  function findExpense(id) {
    for (var i = 0; i < data.expenses.length; i++) {
      if (data.expenses[i].id === id) return data.expenses[i];
    }
    return null;
  }

  function isOwner(b) {
    return !!b && b.ownerUid === me().uid;
  }

  /* ---------- 스낵바 ---------- */

  function snack(message, undo) {
    clearTimeout(ui.snackTimer);
    ui.snack = { text: message, undo: undo || null };
    ui.snackTimer = setTimeout(function () {
      ui.snack = null;
      render();
    }, 3400);
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

  function authTabStyle(on) {
    return (
      "border:none;background:none;min-height:44px;padding:10px 2px;font-size:15px;letter-spacing:-.02em;font-weight:" +
      (on ? "800" : "500") +
      ";color:" + (on ? "var(--fg)" : "var(--g3)") +
      ";border-bottom:2px solid " + (on ? "var(--fg)" : "transparent") +
      ";margin-bottom:-1px"
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

  /** 네모 체크 상자 (로그인 유지) */
  function keepBoxStyle(on) {
    return (
      "flex:0 0 auto;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:1px solid " +
      (on ? "var(--fg)" : "var(--g2)") +
      ";background:" + (on ? "var(--fg)" : "transparent") + ";color:var(--bg)"
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

  function bigButtonStyle(on, extra) {
    return (
      (extra || "") +
      "width:100%;height:54px;border:none;border-radius:14px;font-size:16px;font-weight:700;background:" +
      (on ? "var(--fg)" : "var(--g1)") + ";color:" + (on ? "var(--bg)" : "var(--g3)")
    );
  }

  /* 시트 안의 주 버튼 (예산·공유 화면) */
  function sheetButtonStyle(on) {
    return (
      "margin-top:14px;width:100%;height:50px;border:none;border-radius:13px;font-size:15px;font-weight:700;background:" +
      (on ? "var(--fg)" : "var(--g1)") + ";color:" + (on ? "var(--bg)" : "var(--g3)")
    );
  }

  /* ---------- 렌더 ---------- */

  var KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

  /** 함께 쓰는 예산에서 "누가 적었는지" 꼬리표 */
  function writerTag(e, budget) {
    if (!budget || !budget.shared) return "";
    var name = calc.memberName(budget, e.uid, e.userName);
    var mine = e.uid && e.uid === me().uid;
    return (
      '<span style="font-size:11px;font-weight:600;color:var(--g3);margin-left:6px">' +
      esc(mine ? "나" : name) + "</span>"
    );
  }

  function expenseRowHTML(e, budget) {
    var c = calc.resolveCategory(e, data.categories);
    return (
      '<div data-act="editExpense" data-id="' + esc(e.id) + '" style="display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--g1);cursor:pointer">' +
        '<div style="font-size:20px;width:26px;text-align:center">' + esc(c.emoji) + "</div>" +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:14px;font-weight:600">' + esc(c.name) + writerTag(e, budget) + "</div>" +
          (e.memo
            ? '<div style="font-size:12px;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</div>"
            : "") +
        "</div>" +
        '<div style="font-size:16px;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</div>" +
      "</div>"
    );
  }

  function render() {
    data = store.get();
    var st = auth.state();
    var ready = appReady();
    var active = ready ? activeBudget() : null;

    /* 테마: 로그인 전에도 제 색으로 (상태바 색까지 같이 간다) */
    document.documentElement.dataset.mm = uiTheme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", uiTheme === "dark" ? "#0a0a0a" : "#ffffff");

    /* 어떤 화면을 보여줄지 */
    var needsSetup = st.status === "unconfigured" || st.status === "sdk-failed";
    show("updateReady", ui.updateReady);
    show("authSetup", needsSetup);
    show("authForm", st.status === "signed-out");
    show("authLoading", st.status === "loading" || (signedIn() && !store.ready()));
    show("noBudget", ready && !active);
    show("hasBudget", ready && !!active);

    show("isHome", ready && !!active && ui.tab === "home");
    show("isHistory", ready && !!active && ui.tab === "history");
    show("isSummary", ready && !!active && ui.tab === "summary");
    show("addOpen", ui.addOpen);
    show("menuOpen", ui.menuOpen);
    show("budgetOpen", ui.budgetOpen);
    show("catsOpen", ui.catsOpen);
    show("shareOpen", ui.shareOpen);
    show("switcherOpen", ui.switcherOpen);
    show("personalOpen", ui.personalOpen);
    show("dayOpen", !!ui.dayOpen);
    show("listMode", ui.historyView === "list");
    show("calMode", ui.historyView === "calendar");
    show("snackOpen", !!ui.snack);
    show("snackUndo", !!(ui.snack && ui.snack.undo));
    show("editing", !!ui.draft.editingId);

    css("tabHome", tabStyle("home"));
    css("tabHistory", tabStyle("history"));
    css("tabSummary", tabStyle("summary"));
    text("themeLabel", uiTheme === "dark" ? "라이트" : "다크");
    text("themeLabelAuth", uiTheme === "dark" ? "라이트" : "다크");

    show("selMode", ui.selMode);
    show("notSelMode", !ui.selMode);

    if (ui.snack) text("snackText", ui.snack.text);

    if (needsSetup) renderSetup(st);
    if (st.status === "signed-out") renderAuth();
    if (!ready) return;

    text("helloName", me().name ? me().name + "님" : "가계부");
    text("accountName", me().name || "이름 없음");
    text("accountEmail", me().email || "");

    if (active) renderHome(active);
    renderView();
    renderAdd(active);
    renderBudgetSheet();
    renderBudgetList();
    renderCats();
    renderShare();
    renderSwitcher();
    renderPersonal();
    renderDaySheet();
  }

  /** 화면에 보이는 기간. 나의 가계부는 이번 달. */
  function budgetPeriodText(b) {
    return calc.periodLabel(calc.effectiveBudget(b, today));
  }

  /** 지금 어떤 상태인지 한 단어로 */
  function budgetStateLabel(b) {
    if (calc.isPersonal(b)) return calc.monthLabel(today);
    var st = calc.budgetStatus(b, today);
    return st === "active" ? "진행 중" : st === "upcoming" ? "예정" : "종료";
  }

  function switcherRowHTML(b, activeId) {
    var on = b.id === activeId;
    var st = calc.computeBudgetStats(b, data.expenses, today);
    return (
      '<button data-act="pickBudget" data-id="' + esc(b.id) +
        '" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:none;background:none;padding:11px 16px">' +
        '<span style="flex:0 0 auto;width:20px;text-align:center;font-size:13px;font-weight:800">' +
          (on ? "✓" : "") + "</span>" +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-size:15px;font-weight:' + (on ? "700" : "600") +
            ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            esc((b.shared ? "👥 " : "") + b.name) + "</span>" +
          '<span style="display:block;font-size:11px;color:var(--g3);margin-top:3px">' +
            esc(budgetPeriodText(b) + " · " + calc.formatWon(st.spent) + " / " +
                calc.formatWon(b.totalAmount) + "원") + "</span>" +
        "</span>" +
        '<span style="flex:0 0 auto;font-size:10px;font-weight:700;color:var(--g3)">' +
          esc(budgetStateLabel(b)) + "</span>" +
      "</button>"
    );
  }

  function switcherHeadHTML(label) {
    return '<div style="font-size:11px;color:var(--g3);padding:10px 16px 2px">' + esc(label) + "</div>";
  }

  /** 예산 고르기 시트 — 나의 가계부와 여행을 나눠 보여준다 */
  function renderSwitcher() {
    if (!ui.switcherOpen) return;
    var activeId = data.settings.activeBudgetId;

    var personal = null;
    var trips = [];
    data.budgets.forEach(function (b) {
      if (calc.isPersonal(b)) personal = b;
      else trips.push(b);
    });

    // 진행 중 -> 예정 -> 종료 순. 같은 상태끼리는 최근에 만든 것부터.
    var rank = { active: 0, upcoming: 1, ended: 2 };
    trips.sort(function (a, b) {
      var d = rank[calc.budgetStatus(a, today)] - rank[calc.budgetStatus(b, today)];
      if (d !== 0) return d;
      return b.createdAt - a.createdAt;
    });

    var out = switcherHeadHTML("나의 가계부");
    out += personal
      ? switcherRowHTML(personal, activeId)
      : '<button data-act="openPersonal" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:none;background:none;padding:11px 16px">' +
          '<span style="flex:0 0 auto;width:20px;text-align:center;font-size:16px">＋</span>' +
          '<span style="flex:1;min-width:0">' +
            '<span style="display:block;font-size:15px;font-weight:600">나의 가계부 만들기</span>' +
            '<span style="display:block;font-size:11px;color:var(--g3);margin-top:3px">여행과 따로, 달마다 이어지는 가계부</span>' +
          "</span></button>";

    if (trips.length) {
      out += switcherHeadHTML("여행");
      out += trips
        .map(function (b) {
          return switcherRowHTML(b, activeId);
        })
        .join("");
    }

    html(el("switcherList"), out);
  }

  /** 나의 가계부 설정 시트 — 기간과 한도는 여기서만 정한다 */
  function renderPersonal() {
    if (!ui.personalOpen) return;
    var custom = ui.pb.mode === "custom";

    css("pbModeMonth", chipStyle(!custom));
    css("pbModeCustom", chipStyle(custom));
    show("pbCustom", custom);

    value(el("pbTotal"), ui.pb.total);
    value(el("pbStart"), ui.pb.start);
    value(el("pbEnd"), ui.pb.end);
    text("pbTotalLabel", custom ? "기간 한도 (선택)" : "한 달 한도 (선택)");

    var month = calc.monthBounds(today);
    text(
      "pbHint",
      custom
        ? "정한 기간이 지나면 기간 종료로 표시됩니다. 다시 이 화면에서 기간을 바꿀 수 있습니다."
        : "달이 바뀌면 새 달로 자동으로 넘어갑니다. 지금은 " +
            calc.periodLabel({ startDate: month.start, endDate: month.end }) + " 기준입니다."
    );
  }

  /* ----- 로그인 전 화면 ----- */

  function renderSetup(st) {
    text(
      "setupReason",
      st.status === "unconfigured"
        ? "js/firebase-config.js에 아직 프로젝트 설정을 넣지 않았습니다. 아래 순서대로 한 번만 해 두면 됩니다."
        : "Firebase 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 열어 주세요." +
            (st.detail ? " (" + st.detail + ")" : "")
    );
  }

  /**
   * 칸 하나가 형식에 맞는지. 맞으면 빈 문자열, 아니면 무엇이 틀렸는지.
   * 입력창에 힌트를 두지 않으므로, 틀렸을 때 여기서 구체적으로 알려 준다.
   */
  function authFieldProblem(field) {
    var a = ui.auth;

    if (field === "authName") {
      if (a.mode !== "signup") return "";
      if (!a.name.trim()) return "이름을 입력해 주세요. 함께 쓸 때 이 이름이 보입니다.";
      return "";
    }

    if (field === "authEmail") {
      if (!a.email) return "이메일을 입력해 주세요.";
      if (!model.isEmail(a.email)) {
        return "이메일 형식이 올바르지 않습니다. name@example.com 처럼 적어 주세요.";
      }
      return "";
    }

    if (field === "authPassword") {
      if (!a.password) return "비밀번호를 입력해 주세요.";
      if (a.password.length < model.MIN_PASSWORD) {
        return "비밀번호는 " + model.MIN_PASSWORD + "자 이상이어야 합니다. 지금 " +
          a.password.length + "자입니다.";
      }
      return "";
    }

    return "";
  }

  /** 칸을 비운 채 지나가는 것까지 잡지는 않는다 (아직 안 쓴 것뿐이므로) */
  function authBlurProblem(field) {
    var a = ui.auth;
    if (field === "authEmail" && !a.email) return "";
    if (field === "authPassword" && !a.password) return "";
    if (field === "authName" && !a.name.trim()) return "";
    return authFieldProblem(field);
  }

  /** 보내기 직전 전체 검사. 처음 걸린 것을 돌려준다. */
  function authProblem() {
    var order = ui.auth.mode === "signup"
      ? ["authName", "authEmail", "authPassword"]
      : ["authEmail", "authPassword"];
    for (var i = 0; i < order.length; i++) {
      var message = authFieldProblem(order[i]);
      if (message) return { field: order[i], message: message };
    }
    return null;
  }

  function renderAuth() {
    var a = ui.auth;
    var isSignup = a.mode === "signup";

    show("isSignup", isSignup);
    show("authError", !!a.error);
    text("authErrorText", a.error);
    text("authTitle", isSignup ? "가계부를 시작합니다" : "환영합니다");

    css("tabLogin", authTabStyle(!isSignup));
    css("tabSignup", authTabStyle(isSignup));

    value(el("authEmail"), a.email);
    value(el("authPassword"), a.password);
    value(el("authName"), a.name);

    var pw = el("authPassword");
    if (pw) pw.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");

    var keep = auth.keepSignedIn();
    css("keepBox", keepBoxStyle(keep));
    text("keepBox", keep ? "✓" : "");
    text(
      "keepHint",
      keep
        ? "이 기기에서는 다음에 열 때도 로그인된 상태입니다. 인터넷이 없어도 바로 들어갑니다."
        : "앱을 완전히 닫으면 로그아웃됩니다. 남의 기기나 공용 기기에서 쓸 때 꺼 두세요."
    );

    // 버튼은 늘 눌린다. 형식이 틀렸으면 눌렀을 때 어디가 틀렸는지 알려 준다.
    // (눌리지 않는 버튼은 왜 안 되는지를 말해 주지 못한다)
    var label = a.busy ? "잠시만요…" : isSignup ? "가입하고 시작" : "로그인";
    var btn = el("authSubmit");
    if (btn) {
      btn.disabled = a.busy;
      btn.textContent = label;
      btn.style.cssText = bigButtonStyle(!a.busy, "margin-top:22px;");
    }
  }

  /* ----- 내역/요약이 바라보는 예산 ----- */

  /* 모든 화면이 같은 예산을 본다. 바꾸는 곳은 '예산 고르기' 하나뿐. */
  function viewBudget() {
    return activeBudget();
  }

  function renderView() {
    if (ui.tab !== "history" && ui.tab !== "summary") return;
    var view = viewBudget();
    if (!view) return;

    var list = calc.budgetExpenses(data.expenses, view, today);
    var spent = calc.sumAmount(list);

    var periodText = calc.periodLabel(calc.effectiveBudget(view, today));
    text("viewPeriodText", periodText);
    text("viewPeriodText2", periodText);
    text("viewSpentText", calc.formatWon(spent));
    text("viewSpentText2", calc.formatWon(spent));
    text("viewTotalText", calc.formatWon(view.totalAmount));
    text("selCountText", ui.selected.length + "개 선택됨");

    var listMode = ui.historyView === "list";
    show("viewEmpty", list.length === 0 && (ui.tab !== "history" || listMode));
    show("hasRows", list.length > 0 && listMode);
    show("hasShares", list.length > 0);

    if (ui.tab === "history") {
      css("calToggle", calToggleStyle());
      if (listMode) renderGroups(list, view);
      else renderCalendar(list, view);
    } else renderSummary(view, list, spent);
  }

  function renderGroups(list, view) {
    var groups = calc.groupByDate(list);
    html(
      el("groups"),
      groups
        .map(function (g) {
          return g.date === today ? todayGroupHTML(g, view) : dayGroupHTML(g, view);
        })
        .join("")
    );
    paintRows();
  }

  function calToggleStyle() {
    var on = ui.historyView === "calendar";
    return (
      "flex:0 0 auto;width:32px;height:32px;padding:0;border-radius:9px;display:grid;place-items:center;border:1px solid " +
      (on ? "var(--fg)" : "var(--g2)") +
      ";background:" + (on ? "var(--fg)" : "none") +
      ";color:" + (on ? "var(--bg)" : "var(--fg)")
    );
  }

  /* 노션 캘린더처럼, 칸 안에서 그날 쓴 내용이 바로 보이게 한다.
     좁은 칸이라 금액을 먼저 두고 이모지로 무엇에 썼는지 훑을 수 있게 했다. */
  function renderCalendar(list, view) {
    var byDate = calc.indexByDate(list);
    var period = calc.effectiveBudget(view, today);
    var grid = calc.monthGrid(ui.calMonth);

    text("calMonthText", calc.monthLabel(ui.calMonth) + " · " + ui.calMonth.slice(0, 4) + "년");

    html(
      el("calGrid"),
      grid
        .map(function (week) {
          return week
            .map(function (cell) {
              var day = byDate[cell.date];
              var isToday = cell.date === today;
              var outside = cell.date < period.startDate || cell.date > period.endDate;
              var dim = !cell.inMonth || outside;

              var num =
                '<div style="display:flex;align-items:center;gap:3px">' +
                  '<span style="font-size:11px;font-weight:' + (isToday ? "800" : "600") + ';' +
                    (isToday
                      ? "background:var(--fg);color:var(--bg);border-radius:9px;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0 4px"
                      : "color:var(--g3)") +
                  '">' + Number(cell.date.slice(8)) + "</span>" +
                "</div>";

              var body = "";
              if (day) {
                var emojis = day.items
                  .slice(0, 3)
                  .map(function (e) {
                    return esc(calc.resolveCategory(e, data.categories).emoji);
                  })
                  .join("");
                body =
                  '<div style="font-size:10.5px;font-weight:800;letter-spacing:-.03em;line-height:1.2;word-break:break-all">' +
                    esc(calc.formatWon(day.sum)) + "</div>" +
                  '<div style="font-size:10px;line-height:1.2">' + emojis +
                    (day.items.length > 3 ? '<span style="color:var(--g3)">+' + (day.items.length - 3) + "</span>" : "") +
                  "</div>";
              }

              return (
                '<button class="mm-cal-cell" data-act="openDay" data-date="' + esc(cell.date) + '"' +
                  (day ? "" : " disabled") +
                  (dim ? ' style="opacity:.38"' : "") + ">" +
                  num + body +
                "</button>"
              );
            })
            .join("");
        })
        .join("")
    );
  }

  /** 달력에서 고른 날짜의 내역. 여기서도 고치고 지울 수 있다. */
  function renderDaySheet() {
    if (!ui.dayOpen) return;
    var view = viewBudget();
    if (!view) return;
    var items = calc
      .budgetExpenses(data.expenses, view, today)
      .filter(function (e) {
        return e.date === ui.dayOpen;
      });

    text("dayTitle", calc.dayLabel(ui.dayOpen, today));
    text("daySum", calc.formatWon(calc.sumAmount(items)) + "원");

    html(
      el("dayList"),
      items.length
        ? items
            .map(function (e) {
              var c = calc.resolveCategory(e, data.categories);
              return (
                '<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--g1)">' +
                  '<button data-act="editExpense" data-id="' + esc(e.id) +
                    '" style="flex:1;min-width:0;display:flex;align-items:center;gap:11px;border:none;background:none;padding:0;text-align:left">' +
                    '<span style="font-size:19px;width:24px;text-align:center">' + esc(c.emoji) + "</span>" +
                    '<span style="flex:1;min-width:0">' +
                      '<span style="display:block;font-size:14px;font-weight:600">' + esc(c.name) + writerTag(e, view) + "</span>" +
                      (e.memo
                        ? '<span style="display:block;font-size:12px;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</span>"
                        : "") +
                    "</span>" +
                    '<span style="font-size:15px;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</span>" +
                  "</button>" +
                  '<button data-act="removeExpense" data-id="' + esc(e.id) +
                    '" style="flex:0 0 auto;border:none;background:none;padding:6px 2px;font-size:12px;color:var(--g3)">삭제</button>' +
                "</div>"
              );
            })
            .join("")
        : '<div style="padding:26px 0;text-align:center;font-size:13px;color:var(--g3)">이 날은 기록이 없습니다</div>'
    );
  }

  function rowsHTML(g, view) {
    return g.items
      .map(function (e) {
        return swipeRowHTML(e, view);
      })
      .join("");
  }

  function dayGroupHTML(g, view) {
    return (
      '<div style="padding-bottom:18px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 0 4px">' +
          '<div style="font-size:12px;font-weight:700;color:var(--g3)">' + esc(calc.dayLabel(g.date, today)) + "</div>" +
          '<div style="font-size:12px;color:var(--g3)">' + esc(calc.formatWon(g.sum)) + "원</div>" +
        "</div>" +
        rowsHTML(g, view) +
      "</div>"
    );
  }

  /* 오늘 쓴 것이 제일 궁금하다. 테두리를 둘러 목록에서 먼저 눈에 띄게 한다. */
  function todayGroupHTML(g, view) {
    return (
      '<div style="border:1px solid var(--fg);border-radius:16px;padding:2px 14px 10px;margin:2px 0 20px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:13px 0 7px">' +
          '<div style="font-size:14px;font-weight:800;letter-spacing:-.01em">오늘' +
            '<span style="font-size:11px;font-weight:600;color:var(--g3);margin-left:7px">' +
              esc(calc.dayLabel(g.date, null)) + "</span></div>" +
          '<div style="font-size:19px;font-weight:800;letter-spacing:-.03em">' + esc(calc.formatWon(g.sum)) +
            '<span style="font-size:12px;font-weight:600;color:var(--g3);margin-left:2px">원</span></div>' +
        "</div>" +
        rowsHTML(g, view) +
        '<div style="font-size:11px;color:var(--g3);padding-top:9px">' + g.items.length + "건</div>" +
      "</div>"
    );
  }

  function swipeRowHTML(e, budget) {
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
            '<div style="font-size:14px;font-weight:600">' + esc(c.name) + writerTag(e, budget) + "</div>" +
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

  function barHTML(pct) {
    return (
      '<div style="height:8px;border-radius:4px;background:var(--g1);overflow:hidden">' +
        '<div style="height:100%;width:' + pct.toFixed(2) + '%;background:var(--fg)"></div>' +
      "</div>"
    );
  }

  /* 카테고리 색은 슬롯 순서대로만 준다. 여덟 번째부터는 새 색을 만들지 않고
     하나로 묶는다 (색이 많아질수록 서로 구별이 안 되기 때문). */
  var COLOR_SLOTS = 7;

  function categoryColor(rank) {
    return rank < COLOR_SLOTS ? "var(--c" + (rank + 1) + ")" : "var(--c-other)";
  }

  function renderSummary(view, list, spent) {
    var shares = calc.categoryShares(list, data.categories);
    var pct = view.totalAmount > 0 ? (spent / view.totalAmount) * 100 : 0;
    text("usedPctText", Math.round(pct) + "%");
    css("donut", donutStyle(view, shares, spent));

    renderMemberSummary(view, list, spent);

    html(
      el("shares"),
      shares
        .map(function (sh, i) {
          var color = categoryColor(i);
          return (
            '<div style="padding-bottom:16px">' +
              '<div style="display:flex;align-items:center;gap:8px;padding-bottom:6px">' +
                '<div style="flex:0 0 auto;width:9px;height:9px;border-radius:3px;background:' + color + '"></div>' +
                '<div style="font-size:16px">' + esc(sh.emoji) + "</div>" +
                '<div style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(sh.name) + "</div>" +
                '<div style="font-size:12px;color:var(--g3)">' + sh.pct.toFixed(0) + "%</div>" +
                '<div style="font-size:13px;font-weight:700;min-width:66px;text-align:right">' + esc(calc.formatWon(sh.amount)) + "원</div>" +
              "</div>" +
              '<div style="height:8px;border-radius:4px;background:var(--g1);overflow:hidden">' +
                '<div style="height:100%;width:' + sh.pct.toFixed(2) + '%;background:' + color + '"></div>' +
              "</div>" +
            "</div>"
          );
        })
        .join("")
    );
  }

  /**
   * 도넛 = 예산 안에서 무엇에 얼마를 썼는지.
   * 색칠된 부분의 크기는 예전처럼 "예산 대비 사용 비율"이고,
   * 그 안이 카테고리별로 나뉜다. 남은 몫은 연한 회색.
   * 조각 사이에 배경색 틈을 둬서 비슷한 색이 붙어도 경계가 보인다.
   */
  function donutStyle(view, shares, spent) {
    var base =
      "position:relative;width:196px;height:196px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:";
    var denom = Math.max(view.totalAmount, spent);
    if (!denom || !shares.length) return base + "var(--g1)";

    var GAP = 0.45; // 조각 사이 틈 (%)
    var stops = [];
    var at = 0;
    shares.forEach(function (sh, i) {
      var width = (sh.amount / denom) * 100;
      if (width <= 0) return;
      var color = categoryColor(i);
      stops.push(color + " " + at.toFixed(3) + "% " + (at + width).toFixed(3) + "%");
      at += width;
      if (i < shares.length - 1 && at + GAP < 100) {
        stops.push("var(--bg) " + at.toFixed(3) + "% " + (at + GAP).toFixed(3) + "%");
        at += GAP;
      }
    });
    if (at < 100) stops.push("var(--g1) " + at.toFixed(3) + "% 100%");

    return base + "conic-gradient(" + stops.join(",") + ")";
  }

  /** 함께 쓰는 예산: 사람별 지출 + 누가 누구에게 얼마를 주면 되는지 */
  function renderMemberSummary(view, list, spent) {
    // 아직 한 건도 없으면 0원짜리 줄만 늘어놓게 되므로 내역이 생긴 뒤에 보여준다
    var visible = !!view.shared && list.length > 0;
    show("isSharedSummary", visible);
    if (!visible) return;

    var shares = calc.memberShares(list, view);
    var per = shares.length ? Math.round(spent / shares.length) : 0;
    text("perPersonText", calc.formatWon(per));

    html(
      el("memberShares"),
      shares
        .map(function (s) {
          var mine = s.uid === me().uid;
          var diff = s.amount - per;
          var note =
            diff > 0 ? "+" + calc.formatWon(diff) + "원 더 냄"
            : diff < 0 ? calc.formatWon(-diff) + "원 덜 냄"
            : "딱 맞음";
          return (
            '<div style="padding-bottom:16px">' +
              '<div style="display:flex;align-items:center;gap:8px;padding-bottom:6px">' +
                '<div style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                  esc(s.name) + (mine ? '<span style="font-size:11px;color:var(--g3);font-weight:600;margin-left:6px">나</span>' : "") +
                "</div>" +
                '<div style="font-size:12px;color:var(--g3)">' + s.pct.toFixed(0) + "%</div>" +
                '<div style="font-size:13px;font-weight:700;min-width:66px;text-align:right">' + esc(calc.formatWon(s.amount)) + "원</div>" +
              "</div>" +
              barHTML(s.pct) +
              '<div style="font-size:11px;color:var(--g3);padding-top:5px">' + esc(note) + "</div>" +
            "</div>"
          );
        })
        .join("")
    );

    var moves = calc.settlement(shares);
    show("hasSettlement", moves.length > 0);
    show("settledUp", moves.length === 0 && spent > 0);
    html(
      el("settlement"),
      moves
        .map(function (m) {
          return (
            '<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--g1)">' +
              '<div style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                esc(m.fromName) + ' <span style="color:var(--g3)">→</span> ' + esc(m.toName) +
              "</div>" +
              '<div style="font-size:14px;font-weight:700;flex:0 0 auto">' + esc(calc.formatWon(m.amount)) + "원</div>" +
            "</div>"
          );
        })
        .join("")
    );
  }

  function renderHome(active) {
    var s = calc.computeBudgetStats(active, data.expenses, today);

    text("homeBudgetName", active.name + " · " + budgetPeriodText(active));
    show("isSharedHome", !!active.shared);
    text("memberLine", calc.memberNames(active, me().uid) + "과 함께 쓰는 중");

    show("hasLimit", s.hasLimit);
    show("noLimit", !s.hasLimit);
    show("isPersonalHome", calc.isPersonal(active));

    text("mainLabel", s.hasLimit ? "남은 금액" : "쓴 돈");
    text("remainingText", calc.formatWon(s.hasLimit ? s.remaining : s.spent));
    text("spentText", calc.formatWon(s.spent));
    text("totalText", calc.formatWon(s.total));

    css(
      "gauge",
      "height:100%;width:" + s.spentPct.toFixed(2) + "%;background:" +
        (s.overToday ? STRIPES : "var(--fg)") + ";transition:width .3s ease"
    );

    // 한도가 없으면 권장액 대신 하루 평균. 기간이 끝나면 값만 —
    text("perDayLabel", s.hasLimit ? "오늘 쓸 수 있는 돈" : "하루 평균");
    text(
      "perDayText",
      !s.hasLimit ? calc.formatWon(s.avgPerDay) : s.ended ? "—" : calc.formatWon(s.perDay)
    );
    text("todaySpentText", calc.formatWon(s.todaySpent));
    text(
      "daysLeftText",
      s.ended
        ? (calc.isPersonal(active) ? "기간 종료 · 설정에서 기간을 바꿔 주세요" : "기간 종료 · 새 예산을 만들어 주세요")
        : s.hasLimit
          ? "남은 기간 " + s.daysLeft + "일"
          : s.elapsedDays + "일째 기록 중"
    );

    var inPeriod = calc.budgetExpenses(data.expenses, active, today);
    var period = calc.effectiveBudget(active, today);
    var todayInRange = today >= period.startDate && today <= period.endDate;
    // 기간이 지난 예산에서 "오늘 내역"은 영원히 비어 있다.
    // 그럴 때는 마지막으로 쓴 날을 대신 보여준다.
    var pickDate = todayInRange ? today : inPeriod.length ? inPeriod[0].date : today;
    var picked = inPeriod.filter(function (e) {
      return e.date === pickDate;
    });

    text("todayListTitle", pickDate === today ? "오늘 내역" : calc.dayLabel(pickDate, today) + " 내역");
    show("todayEmpty", picked.length === 0);
    html(
      el("todayList"),
      picked
        .map(function (e) {
          return expenseRowHTML(e, active);
        })
        .join("")
    );

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
      var period = calc.effectiveBudget(active, today);
      dateInput.min = period.startDate;
      dateInput.max = period.endDate;
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
          var mine = isOwner(b);
          return (
            '<div style="display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--g1)">' +
              '<button data-act="activateBudget" data-id="' + esc(b.id) + '" style="flex:1;min-width:0;text-align:left;border:none;background:none;padding:0">' +
                '<div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                  esc((b.shared ? "👥 " : "") + b.name) + "</div>" +
                '<div style="font-size:11px;color:var(--g3);margin-top:3px">' +
                  esc(calc.periodLabel(b) + " · " + calc.formatWon(st.spent) + " / " + calc.formatWon(b.totalAmount)) + "원</div>" +
              "</button>" +
              '<div style="font-size:11px;color:var(--g3);flex:0 0 auto">' + state + "</div>" +
              '<button data-act="' + (mine ? "removeBudget" : "leaveBudgetFromList") + '" data-id="' + esc(b.id) +
                '" style="border:none;background:none;padding:0 2px;font-size:12px;color:var(--g3);flex:0 0 auto">' +
                (mine ? "삭제" : "나가기") + "</button>" +
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

  /* ----- 함께 쓰기 ----- */

  function shareTarget() {
    return viewBudget();
  }

  function renderShare() {
    if (!ui.shareOpen) return;
    var b = shareTarget();

    show("shareHasBudget", !!b);
    show("shareNoBudget", !b);
    show("shareError", !!ui.share.error);
    text("shareErrorText", ui.share.error);

    value(el("joinCode"), ui.share.code);
    var joinOk = !ui.share.busy && model.normalizeInviteCode(ui.share.code).length === model.INVITE_LENGTH;
    disable(el("joinButton"), !joinOk, sheetButtonStyle(true), sheetButtonStyle(false));

    if (!b) return;

    var owner = isOwner(b);
    text("shareBudgetName", b.name + " " + calc.periodLabel(b));
    show("shareNoCode", owner && !b.inviteCode);
    show("shareMemberNoCode", !owner && !b.inviteCode);
    show("shareHasCode", !!b.inviteCode);
    show("isInviteOwner", owner);
    show("canLeave", !owner);
    text("inviteCodeText", b.inviteCode || "");

    disable(el("createInvite"), ui.share.busy, sheetButtonStyle(true), sheetButtonStyle(false));

    html(
      el("memberList"),
      b.memberUids
        .map(function (u) {
          var name = calc.memberName(b, u, "");
          var tags = [];
          if (u === b.ownerUid) tags.push("만든 사람");
          if (u === me().uid) tags.push("나");
          return (
            '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--g1)">' +
              '<div style="flex:1;min-width:0;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + "</div>" +
              (tags.length ? '<div style="font-size:11px;color:var(--g3);flex:0 0 auto">' + esc(tags.join(" · ")) + "</div>" : "") +
              (owner && u !== me().uid
                ? '<button data-act="kickMember" data-id="' + esc(u) + '" style="border:none;background:none;padding:0 2px;font-size:12px;color:var(--g3);flex:0 0 auto">내보내기</button>'
                : "") +
            "</div>"
          );
        })
        .join("")
    );
  }

  /* ---------- 동작 ---------- */

  function openAdd() {
    ui.draft = { amount: 0, categoryId: null, memo: "", date: clampToBudget(today), editingId: null };
    ui.addOpen = true;
    hideSnack();
    render();
  }

  /** 오늘이 예산 기간 밖이면 가장 가까운 날짜로 (기간 밖 지출은 합계에서 빠져 혼란스럽다) */
  function clampToBudget(date) {
    var b = activeBudget();
    if (!b) return date;
    var e = calc.effectiveBudget(b, today);
    if (date < e.startDate) return e.startDate;
    if (date > e.endDate) return e.endDate;
    return date;
  }

  function editExpense(id) {
    var e = findExpense(id);
    if (!e) return;
    ui.dayOpen = null;
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
      store.patchExpense(d.editingId, {
        amount: d.amount,
        categoryId: d.categoryId,
        memo: d.memo,
        date: d.date
      });
      ui.addOpen = false;
      ui.draft.editingId = null;
      snack("수정됨", null);
      render();
      return;
    }

    var active = activeBudget();
    if (!active) return;

    var created = {
      budgetId: active.id,
      amount: d.amount,
      categoryId: d.categoryId,
      memo: d.memo,
      date: d.date,
      createdAt: Date.now()
    };
    var newId = store.addExpense(created);
    ui.addOpen = false;
    ui.tab = "home";

    var c = calc.resolveCategory({ categoryId: d.categoryId }, data.categories);
    snack(calc.formatWon(created.amount) + "원 · " + c.name + " 저장", function () {
      store.removeExpenses([{ id: newId, budgetId: created.budgetId }]);
    });
    render();
  }

  function removeExpense(id) {
    var gone = findExpense(id);
    if (!gone) return;
    var copy = model.clone(gone);
    store.removeExpenses([gone]);
    ui.addOpen = false;
    ui.draft.editingId = null;
    snack("삭제됨", function () {
      store.restoreExpenses([copy]);
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
    var copies = model.clone(gone);
    store.removeExpenses(gone);
    ui.selMode = false;
    ui.selected = [];
    ui.swipedId = null;
    snack(label || ids.length + "건 삭제됨", function () {
      store.restoreExpenses(copies);
    });
    render();
  }

  function createBudget() {
    var total = calc.parseAmount(ui.nb.total);
    if (!calc.isValidAmount(total)) return;
    if (!calc.isISODate(ui.nb.start) || !calc.isISODate(ui.nb.end)) return;
    if (ui.nb.end < ui.nb.start) return;

    var id = store.addBudget({
      name: (ui.nb.name || "").trim() || "예산",
      startDate: ui.nb.start,
      endDate: ui.nb.end,
      totalAmount: total
    });
    ui.budgetOpen = false;
    ui.tab = "home";
    ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
    render();
  }

  /* ----- 공유 ----- */

  function shareBusy(on) {
    ui.share.busy = on;
    render();
  }

  function shareFail(err) {
    ui.share.busy = false;
    ui.share.error = auth.messageOf(err);
    render();
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    // 옛 사파리 대비
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = t;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:absolute;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("복사할 수 없습니다."));
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ----- 새로고침 / 업데이트 ----- */

  function doRefresh() {
    var jobs = [
      signedIn() ? store.refresh() : Promise.resolve(null),
      MP.updater.check()
    ];
    return Promise.all(jobs).then(function (r) {
      var synced = r[0];
      if (MP.updater.hasUpdate()) {
        ui.updateReady = true;
        render();
        snack("새 버전이 준비됐습니다. 위의 '지금 받기'를 눌러 주세요.", null);
        render();
        return;
      }
      if (synced === false) snack("오프라인입니다. 저장된 내용을 보여줍니다.", null);
      else snack("최신 상태입니다", null);
      render();
    });
  }

  /* ---------- 이벤트 ---------- */

  var ACTIONS = {
    /* --- 인증 --- */
    authModeLogin: function () {
      ui.auth.mode = "login";
      ui.auth.error = "";
      render();
    },
    authModeSignup: function () {
      ui.auth.mode = "signup";
      ui.auth.error = "";
      render();
    },
    authSubmit: function () {
      var a = ui.auth;
      if (a.busy) return;

      var problem = authProblem();
      if (problem) {
        a.error = problem.message;
        render();
        // 틀린 칸으로 커서를 옮겨 준다 — 어디를 고쳐야 하는지 바로 보이게
        var node = el(problem.field);
        if (node) node.focus();
        return;
      }

      a.busy = true;
      a.error = "";
      render();

      var work = a.mode === "signup"
        ? auth.signUp(a.email, a.password, a.name)
        : auth.signIn(a.email, a.password);

      work.then(
        function () {
          // 성공하면 onAuthStateChanged가 화면을 넘긴다
          ui.auth = { mode: "login", email: "", password: "", name: "", error: "", busy: false };
          render();
        },
        function (err) {
          a.busy = false;
          a.error = auth.messageOf(err);
          render();
        }
      );
    },
    toggleKeepSignedIn: function () {
      var next = !auth.keepSignedIn();
      auth.setKeepSignedIn(next);
      render();
    },
    authReset: function () {
      var a = ui.auth;
      if (!model.isEmail(a.email)) {
        a.error = a.email
          ? "이메일 형식이 올바르지 않습니다. 재설정 링크를 보낼 주소를 정확히 적어 주세요."
          : "먼저 이메일을 입력해 주세요. 그 주소로 재설정 링크를 보냅니다.";
        render();
        var node = el("authEmail");
        if (node) node.focus();
        return;
      }
      auth.resetPassword(a.email).then(
        function () {
          a.error = a.email + " 로 비밀번호 재설정 메일을 보냈습니다.";
          render();
        },
        function (err) {
          a.error = auth.messageOf(err);
          render();
        }
      );
    },
    signOut: function () {
      if (!confirm("로그아웃할까요?\n\n기록은 계정에 저장돼 있어서 다시 로그인하면 그대로 보입니다.")) return;
      ui.menuOpen = false;
      render();
      auth.signOut().catch(function (err) {
        snack(auth.messageOf(err), null);
        render();
      });
    },
    renameMe: function () {
      var next = prompt("함께 쓸 때 보이는 이름", me().name || "");
      if (next == null) return;
      if (!next.trim()) return;
      auth.rename(next).then(
        function (user) {
          store.syncMyName(user.name);
          snack("이름을 바꿨습니다", null);
          render();
        },
        function (err) {
          snack(auth.messageOf(err), null);
          render();
        }
      );
    },

    /* --- 지출 --- */
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
    removeExpense: function (node) {
      removeExpense(node.getAttribute("data-id"));
    },

    /* --- 메뉴 --- */
    openMenu: function () {
      closeSheets();
      ui.menuOpen = true;
      render();
    },
    closeMenu: function () {
      ui.menuOpen = false;
      render();
    },
    openBudget: function () {
      closeSheets();
      ui.budgetOpen = true;
      ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
      render();
    },

    /* --- 예산 고르기 --- */
    openSwitcher: function () {
      closeSheets();
      ui.switcherOpen = true;
      render();
    },
    closeSwitcher: function () {
      ui.switcherOpen = false;
      render();
    },
    pickBudget: function (node) {
      var id = node.getAttribute("data-id");
      store.setActiveBudget(id);
      ui.switcherOpen = false;
      ui.selMode = false;
      ui.selected = [];
      ui.swipedId = null;
      render();
    },
    /** 어느 화면에서 눌러도 곧장 새 예산 입력으로 */
    newBudget: function () {
      closeSheets();
      ui.budgetOpen = true;
      ui.nb = { name: "", start: today, end: calc.addDays(today, 6), total: "" };
      render();
      var node = el("nbName");
      if (node) node.focus();
    },
    /**
     * 나의 가계부. 없으면 묻지 않고 바로 만들어서 기록을 시작하고,
     * 이미 있으면 설정(기간·한도) 화면을 연다.
     */
    openPersonal: function () {
      var mine = store.personalBudget();
      if (!mine) {
        store.addPersonalBudget(today);
        closeSheets();
        ui.tab = "home";
        render();
        snack("나의 가계부를 시작했습니다. 바로 기록해 보세요.", null);
        render();
        return;
      }
      if (data.settings.activeBudgetId !== mine.id) store.setActiveBudget(mine.id);
      closeSheets();
      ui.tab = "home";
      ui.personalOpen = true;
      ui.pb = {
        total: mine.totalAmount ? calc.formatWon(mine.totalAmount) : "",
        mode: mine.periodMode === "custom" ? "custom" : "month",
        start: mine.startDate,
        end: mine.endDate
      };
      render();
    },
    closePersonal: function () {
      ui.personalOpen = false;
      render();
    },
    pbModeMonth: function () {
      ui.pb.mode = "month";
      render();
    },
    pbModeCustom: function () {
      ui.pb.mode = "custom";
      render();
    },
    savePersonal: function () {
      var mine = store.personalBudget();
      if (!mine) return;
      if (ui.pb.mode === "custom") {
        if (!calc.isISODate(ui.pb.start) || !calc.isISODate(ui.pb.end)) {
          snack("기간을 정확히 골라 주세요", null);
          render();
          return;
        }
        if (ui.pb.end < ui.pb.start) {
          snack("종료일이 시작일보다 앞설 수 없습니다", null);
          render();
          return;
        }
      }
      store.updatePersonal(mine.id, {
        totalAmount: calc.parseAmount(ui.pb.total),
        periodMode: ui.pb.mode,
        startDate: ui.pb.start,
        endDate: ui.pb.end,
        todayIso: today
      });
      ui.personalOpen = false;
      render();
      snack("저장했습니다", null);
      render();
    },

    /** 어느 화면에서 눌러도 곧장 초대 코드 입력으로 */
    joinTrip: function () {
      closeSheets();
      ui.shareOpen = true;
      ui.share = { code: "", error: "", busy: false };
      render();
      focusJoinCode();
    },
    closeBudget: function () {
      ui.budgetOpen = false;
      render();
    },
    createBudget: createBudget,
    applyUpdate: function () {
      // 갈아탈 워커가 사라졌다면 캐시를 비우고 새로 받는 것이 확실한 복구다
      if (!MP.updater.apply()) MP.updater.hardReset();
    },

    /* --- 탭 --- */
    goHome: function () { ui.tab = "home"; ui.swipedId = null; ui.selMode = false; ui.selected = []; render(); },
    goHistory: function () {
      ui.tab = "history";
      ui.selMode = false; ui.selected = []; ui.swipedId = null;
      render();
    },
    goSummary: function () {
      ui.tab = "summary";
      render();
    },
    /* --- 달력 --- */
    toggleCalendar: function () {
      ui.historyView = ui.historyView === "calendar" ? "list" : "calendar";
      ui.selMode = false;
      ui.selected = [];
      ui.swipedId = null;
      // 달력을 열 때는 오늘이 있는 달부터 (기간 밖이면 예산이 시작한 달)
      if (ui.historyView === "calendar") {
        var view = viewBudget();
        var period = view ? calc.effectiveBudget(view, today) : null;
        ui.calMonth =
          period && (today < period.startDate || today > period.endDate) ? period.startDate : today;
      }
      render();
    },
    calPrev: function () {
      ui.calMonth = calc.addMonths(ui.calMonth, -1);
      render();
    },
    calNext: function () {
      ui.calMonth = calc.addMonths(ui.calMonth, 1);
      render();
    },
    openDay: function (node) {
      ui.dayOpen = node.getAttribute("data-date");
      hideSnack();
      render();
    },
    closeDay: function () {
      ui.dayOpen = null;
      render();
    },
    /** 팝업에서 그 날짜로 바로 지출을 추가한다 */
    addOnDay: function () {
      var date = ui.dayOpen;
      ui.dayOpen = null;
      openAdd();
      ui.draft.date = clampToBudget(date);
      render();
    },

    enterSel: function () { enterSelWith(null); },
    exitSel: function () { ui.selMode = false; ui.selected = []; render(); },
    selectAll: function () {
      var view = viewBudget();
      if (!view) return;
      ui.selected = calc.budgetExpenses(data.expenses, view, today).map(function (e) { return e.id; });
      paintRows();
      text("selCountText", ui.selected.length + "개 선택됨");
    },
    deleteSelected: function () { removeMany(ui.selected.slice()); },

    deleteAllInHistory: function () {
      var view = viewBudget();
      if (!view) { render(); return; }
      var ids = calc.budgetExpenses(data.expenses, view, today).map(function (e) { return e.id; });
      if (!ids.length) {
        render();
        snack("지울 내역이 없습니다", null);
        render();
        return;
      }
      var warn = view.shared
        ? "\n\n함께 쓰는 예산입니다. 다른 사람이 적은 내역도 함께 지워집니다."
        : "";
      if (!confirm('"' + view.name + '" 예산의 지출 ' + ids.length + "건을 모두 지웁니다." + warn + "\n\n계속할까요?")) {
        render();
        return;
      }
      removeMany(ids, ids.length + "건 삭제됨");
    },

    /* --- 예산 --- */
    activateBudget: function (node) {
      var id = node.getAttribute("data-id");
      store.setActiveBudget(id);
      ui.budgetOpen = false;
      ui.tab = "home";
      render();
    },
    removeBudget: function (node) {
      var id = node.getAttribute("data-id");
      var b = findBudget(id);
      if (!b) return;
      if (!isOwner(b)) {
        snack("예산을 만든 사람만 지울 수 있습니다", null);
        render();
        return;
      }
      var n = data.expenses.filter(function (e) { return e.budgetId === id; }).length;
      var others = b.memberUids.length - 1;
      var msg = '"' + b.name + '" 예산을 지웁니다.\n' +
        (n > 0 ? "이 예산에 기록한 지출 " + n + "건도 함께 삭제됩니다.\n" : "") +
        (others > 0 ? "함께 쓰는 " + others + "명의 화면에서도 사라집니다.\n" : "") +
        "\n되돌릴 수 없습니다. 계속할까요?";
      if (!confirm(msg)) return;
      store.removeBudget(id);
      render();
    },
    leaveBudgetFromList: function (node) {
      leaveBudget(node.getAttribute("data-id"));
    },

    /* --- 함께 쓰기 --- */
    openShare: function () {
      closeSheets();
      ui.shareOpen = true;
      ui.share = { code: "", error: "", busy: false };
      render();
    },
    closeShare: function () {
      ui.shareOpen = false;
      render();
    },
    createInvite: function () {
      var b = shareTarget();
      if (!b) return;
      if (b.inviteCode && !confirm("코드를 새로 만들면 지금 코드는 바로 못 쓰게 됩니다.\n계속할까요?")) return;
      ui.share.error = "";
      shareBusy(true);
      store.shareBudget(b.id).then(
        function () {
          ui.share.busy = false;
          snack("초대 코드를 만들었습니다", null);
          render();
        },
        shareFail
      );
    },
    stopInvites: function () {
      var b = shareTarget();
      if (!b) return;
      if (!confirm("초대 코드를 끕니다.\n이미 들어와 있는 사람은 그대로 함께 씁니다.\n\n계속할까요?")) return;
      ui.share.error = "";
      shareBusy(true);
      store.stopInvites(b.id).then(
        function () {
          ui.share.busy = false;
          snack("초대를 껐습니다", null);
          render();
        },
        shareFail
      );
    },
    copyInvite: function () {
      var b = shareTarget();
      if (!b || !b.inviteCode) return;
      copyText(b.inviteCode).then(
        function () {
          snack("초대 코드를 복사했습니다", null);
          render();
        },
        function () {
          ui.share.error = "복사할 수 없습니다. 코드를 직접 적어 전달해 주세요.";
          render();
        }
      );
    },
    shareInvite: function () {
      var b = shareTarget();
      if (!b || !b.inviteCode) return;
      var body =
        '"' + b.name + '" 여행 가계부에 초대합니다.\n' +
        "가계부 앱에서 [여행 가계부 함께 쓰기] → 초대 코드에 아래를 입력하세요.\n\n" +
        b.inviteCode;
      if (navigator.share) {
        navigator.share({ title: "여행 가계부 초대", text: body }).catch(function () {});
        return;
      }
      copyText(body).then(
        function () {
          snack("초대 문구를 복사했습니다", null);
          render();
        },
        function () {
          ui.share.error = "공유할 수 없습니다. 코드를 직접 전달해 주세요.";
          render();
        }
      );
    },
    joinByCode: function () {
      var code = model.normalizeInviteCode(ui.share.code);
      ui.share.error = "";
      shareBusy(true);
      store.joinByCode(code).then(
        function (r) {
          ui.share.busy = false;
          ui.share.code = "";
          ui.shareOpen = false;
          ui.tab = "home";
          snack(r.alreadyMember ? "이미 함께 쓰고 있는 가계부입니다" : "여행 가계부에 참여했습니다", null);
          render();
        },
        shareFail
      );
    },
    leaveBudget: function () {
      var b = shareTarget();
      if (b) leaveBudget(b.id);
    },
    kickMember: function (node) {
      var b = shareTarget();
      var uid = node.getAttribute("data-id");
      if (!b) return;
      var name = calc.memberName(b, uid, "");
      if (!confirm('"' + name + '"님을 내보냅니다.\n적어 둔 내역은 그대로 남습니다.\n\n계속할까요?')) return;
      ui.share.error = "";
      shareBusy(true);
      store.removeMember(b.id, uid).then(
        function () {
          ui.share.busy = false;
          snack("내보냈습니다", null);
          render();
        },
        shareFail
      );
    },

    /* --- 카테고리 --- */
    openCats: function () { closeSheets(); ui.catsOpen = true; render(); },
    closeCats: function () { flushCategoryPatches(); ui.catsOpen = false; render(); },
    addCat: function () {
      flushCategoryPatches();
      var nameInput = el("newCatName");
      var emojiInput = el("newCatEmoji");
      var name = (nameInput.value || "").trim();
      if (!name) return;
      store.addCategory({ name: name, emoji: (emojiInput.value || "").trim() || "✏️" });
      nameInput.value = "";
      emojiInput.value = "";
      render();
    },
    catUp: function (node) { flushCategoryPatches(); store.moveCategory(node.getAttribute("data-id"), -1); render(); },
    catDown: function (node) { flushCategoryPatches(); store.moveCategory(node.getAttribute("data-id"), 1); render(); },
    catRemove: function (node) {
      flushCategoryPatches();
      var id = node.getAttribute("data-id");
      var c = calc.findCategory(data.categories, id);
      if (!c) return;
      if (data.categories.length <= 1) {
        alert("카테고리는 최소 하나는 있어야 합니다.");
        return;
      }
      var n = model.categoryUsageCount(data, id);
      var msg = '"' + c.name + '" 카테고리를 지웁니다.\n' +
        (n > 0 ? "이 카테고리로 기록한 지출 " + n + "건은 그대로 남고, 이름도 계속 보입니다.\n" : "") +
        "\n계속할까요?";
      if (!confirm(msg)) return;
      store.removeCategory(id);
      render();
    },

    toggleTheme: function () {
      uiTheme = uiTheme === "dark" ? "light" : "dark";
      store.setTheme(uiTheme);
      ui.menuOpen = false;
      render();
    }
  };

  /** 시트끼리 겹쳐 열리지 않게 한 번에 정리한다 */
  function closeSheets() {
    ui.menuOpen = false;
    ui.switcherOpen = false;
    ui.budgetOpen = false;
    ui.shareOpen = false;
    ui.catsOpen = false;
    ui.personalOpen = false;
    ui.dayOpen = null;
  }

  /**
   * 초대 코드 칸으로 바로 데려간다. 참여를 누른 사람은 코드를 칠 준비가 된 상태다.
   * 시트가 올라오는 동안은 아직 화면에 자리를 잡기 전이라 한 박자 뒤에 옮긴다.
   */
  function focusJoinCode() {
    setTimeout(function () {
      var node = el("joinCode");
      if (!node) return;
      try {
        if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
      } catch (e) {
        /* 옵션을 모르는 브라우저면 그냥 넘어간다 */
      }
      try {
        node.focus();
      } catch (e) {}
    }, 80);
  }

  function leaveBudget(id) {
    var b = findBudget(id);
    if (!b) return;
    if (isOwner(b)) {
      snack("만든 사람은 나갈 수 없습니다. 예산을 삭제해 주세요.", null);
      render();
      return;
    }
    if (!confirm('"' + b.name + '" 가계부에서 나갑니다.\n내가 적은 내역은 남습니다.\n\n계속할까요?')) return;
    store.leaveBudget(id).then(
      function () {
        ui.shareOpen = false;
        snack("나왔습니다", null);
        render();
      },
      function (err) {
        snack(auth.messageOf(err), null);
        render();
      }
    );
  }

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
    else if (name === "pbStart") { ui.pb.start = node.value; renderPersonal(); }
    else if (name === "pbEnd") { ui.pb.end = node.value; renderPersonal(); }
    else if (name === "pbTotal") {
      var pn = calc.parseAmount(node.value);
      ui.pb.total = pn ? calc.formatWon(pn) : "";
      node.value = ui.pb.total;
      renderPersonal();
    }
    else if (name === "nbTotal") {
      var n = calc.parseAmount(node.value);
      ui.nb.total = n ? calc.formatWon(n) : "";
      node.value = ui.nb.total;
      renderBudgetSheet();
    }
    // 고치는 중에는 지적을 거둔다 (타이핑하는 내내 빨간 소리를 듣지 않게)
    else if (name === "authEmail") { ui.auth.email = node.value.trim(); clearAuthError(); }
    else if (name === "authPassword") { ui.auth.password = node.value; clearAuthError(); }
    else if (name === "authName") { ui.auth.name = node.value; clearAuthError(); }
    else if (name === "joinCode") {
      ui.share.code = model.normalizeInviteCode(node.value);
      node.value = ui.share.code;
      renderShare();
    } else return;

    if (name === "draftMemo" || name === "draftDate") renderAdd(activeBudget());
  });

  /** 타이핑을 시작하면 지적을 지운다. 입력창 자체는 건드리지 않는다. */
  function clearAuthError() {
    if (!ui.auth.error) return;
    ui.auth.error = "";
    show("authError", false);
    text("authErrorText", "");
  }

  /* 엔터로 로그인 */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var name = ev.target.getAttribute && ev.target.getAttribute("data-el");
    if (name === "authEmail" || name === "authPassword" || name === "authName") {
      ev.preventDefault();
      ACTIONS.authSubmit();
    } else if (name === "joinCode") {
      ev.preventDefault();
      var btn = el("joinButton");
      if (btn && !btn.disabled) ACTIONS.joinByCode();
    }
  });

  /* 카테고리 이름/이모지 인라인 수정.
     글자마다 서버에 쓰면 낭비라서, 잠깐 멈췄을 때 한 번만 보낸다. */
  var catTimers = {};

  function queueCategoryPatch(id, field, value) {
    var key = id + ":" + field;
    clearTimeout(catTimers[key]);
    catTimers[key] = setTimeout(function () {
      delete catTimers[key];
      var patch = {};
      patch[field] = value;
      store.patchCategory(id, patch);
    }, 500);
  }

  /** 화면을 떠나기 전에 밀린 수정을 바로 보낸다 */
  function flushCategoryPatches() {
    Object.keys(catTimers).forEach(function (key) {
      clearTimeout(catTimers[key]);
      delete catTimers[key];
      var parts = key.split(":");
      var node = document.querySelector(
        '[data-catfield="' + parts[1] + '"][data-id="' + parts[0] + '"]'
      );
      if (!node) return;
      var patch = {};
      patch[parts[1]] = node.value;
      store.patchCategory(parts[0], patch);
    });
  }

  document.addEventListener("input", function (ev) {
    var node = ev.target;
    if (!node.getAttribute) return;

    var field = node.getAttribute("data-catfield");
    if (field) {
      queueCategoryPatch(node.getAttribute("data-id"), field, node.value);
      return; // 목록을 다시 그리지 않는다 (포커스 유지)
    }

    if (node.getAttribute("data-el") === "newCatName") renderCats();
  });

  /* 포커스를 옮기면 밀린 수정을 바로 보낸다.
     비운 채 나갔으면 원래 값으로 되돌린다 (이름 없는 카테고리는 만들지 않는다). */
  document.addEventListener("blur", function (ev) {
    var node = ev.target;
    if (!node.getAttribute) return;

    /* 계정 입력: 칸을 벗어날 때 형식을 확인한다 */
    var elName = node.getAttribute("data-el");
    if (elName === "authEmail" || elName === "authPassword" || elName === "authName") {
      var problem = authBlurProblem(elName);
      if (problem) {
        ui.auth.error = problem;
        render();
      }
      return;
    }

    if (!node.getAttribute("data-catfield")) return;
    var id = node.getAttribute("data-id");
    var field = node.getAttribute("data-catfield");

    if (!(node.value || "").trim()) {
      var key = id + ":" + field;
      clearTimeout(catTimers[key]);
      delete catTimers[key];
      var c = calc.findCategory(data.categories, id);
      if (c) node.value = field === "name" ? c.name : c.emoji;
      return;
    }
    flushCategoryPatches();
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

  /* ---------- 구독 ---------- */

  store.subscribe(function (next) {
    data = next;
    uiTheme = data.settings.theme;
    render();
    maybeOfferLegacyImport();
  });

  store.onError(function (message) {
    snack(message, null);
    render();
  });

  auth.subscribe(function (st) {
    if (st.status === "signed-in") {
      store.start(st.user);
      ui.auth = { mode: "login", email: "", password: "", name: "", error: "", busy: false };
    } else {
      store.stop();
      data = store.get();
      uiTheme = data.settings.theme;
      ui.tab = "home";
      ui.addOpen = false;
      closeSheets();
      ui.selMode = false;
      ui.selected = [];
      legacyAsked = false;
      hideSnack();
    }
    render();
  });

  /** 로그인 전에 이 기기에서 쓰던 내역이 있으면 한 번만 물어본다 */
  function maybeOfferLegacyImport() {
    if (legacyAsked || !appReady()) return;
    var old = store.legacy();
    if (!old) return;
    legacyAsked = true;

    var n = old.expenses.length;
    var msg =
      "이 기기에 로그인 전에 쓰던 기록이 있습니다.\n" +
      "예산 " + old.budgets.length + "개, 지출 " + n + "건.\n\n" +
      "지금 계정으로 옮길까요?";
    if (!confirm(msg)) {
      store.skipLegacy();
      return;
    }
    store.importLegacy().then(
      function (count) {
        snack("지출 " + count + "건을 계정으로 옮겼습니다", null);
        render();
      },
      function (err) {
        legacyAsked = false; // 실패하면 다음에 다시 물어본다
        snack(auth.messageOf(err), null);
        render();
      }
    );
  }

  /* ---------- 자정 / 화면 복귀 ---------- */

  function checkDate() {
    var now = calc.todayISO();
    if (now === today) return;
    today = now;
    if (!ui.draft.editingId && !ui.addOpen) ui.draft.date = today;
    render();
  }
  setInterval(checkDate, 30000);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    checkDate();
    render();
    // 앱으로 돌아올 때마다 새 버전이 올라왔는지 조용히 확인한다
    MP.updater.check().then(function () {
      if (!MP.updater.hasUpdate() || ui.updateReady) return;
      ui.updateReady = true;
      render();
    });
  });
  window.addEventListener("focus", checkDate);

  /* 화면 크기가 바뀌면 큰 숫자 맞춤을 다시 계산 */
  window.addEventListener("resize", function () {
    render();
  });

  /* ---------- 시작 ---------- */

  render();
  auth.init();

  MP.updater.onUpdate(function (has) {
    if (!has || ui.updateReady) return;
    ui.updateReady = true;
    render();
  });

  /* 오프라인 지원 + 새 버전 감지. file://로 열었을 땐 서비스 워커를 쓸 수 없으므로 건너뛴다. */
  MP.updater.install();

  /* 웹앱에는 주소창이 없다 — 위에서 아래로 당기면 새로고침 */
  MP.pullToRefresh.install({
    host: el("frame"),
    scroller: function () {
      return appReady() && activeBudget() ? el("scroller") : null;
    },
    canPull: function () {
      if (ui.addOpen || ui.menuOpen || ui.budgetOpen || ui.catsOpen || ui.shareOpen) return false;
      if (ui.switcherOpen || ui.personalOpen || ui.dayOpen) return false;
      if (ui.selMode || ui.swipedId) return false;
      var s = auth.state().status;
      return s === "signed-in" || s === "signed-out";
    },
    onEngage: clearTouch,
    onRefresh: doRefresh
  });
})();
