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
    dialog: null,           // 앱 안에서 뜨는 확인창

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
   * 지금 배율. 루트 글자 크기 16px이 기준 화면(390px 폭)이고 배율 1이다.
   * 화면이 바뀌기 전까지 값이 그대로라 한 번만 재고 아껴 쓴다.
   */
  var scaleCache = null;
  function scale() {
    if (scaleCache !== null) return scaleCache;
    var root = 16;
    try {
      root = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    } catch (e) {}
    scaleCache = isFinite(root) && root > 0 ? root / 16 : 1;
    return scaleCache;
  }

  /** 기준 화면 기준의 px을 지금 화면의 px로 */
  function px(designPx) {
    return designPx * scale();
  }

  /**
   * 큰 금액이 화면 밖으로 넘칠 때만 글자를 줄인다.
   * 받는 값은 기준 화면(390px) 기준의 px이고, 그릴 때 배율을 곱한다.
   */
  function fit(node, sibling, baseDesignPx, gapDesignPx) {
    if (!node) return;
    var basePx = px(baseDesignPx);
    node.style.fontSize = basePx + "px";
    var row = node.parentNode;
    if (!row || !row.clientWidth) return; // 숨겨진 상태면 측정 불가
    var avail = row.clientWidth - (sibling ? sibling.offsetWidth : 0) - px(gapDesignPx || 0);
    var want = node.scrollWidth;
    if (avail > 0 && want > avail) {
      node.style.fontSize = Math.max(px(11), Math.floor(basePx * (avail / want))) + "px";
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

  /* ---------- 확인창 ---------- */

  /**
   * 앱 안에서 뜨는 확인창. 브라우저 기본 창(confirm/prompt/alert) 대신 쓴다.
   * 기본 창은 우리 테마도 글꼴도 따르지 않아서 앱 밖으로 튀어나온 것처럼 보인다.
   *
   * opts: { title, body, ok, cancel, input, value, placeholder, maxlength }
   *   cancel 을 null 로 주면 알림창(확인 하나)이 된다.
   * onOk(value) — 확인을 눌렀을 때. onCancel — 취소했을 때(필요한 경우만).
   */
  function ask(opts, onOk, onCancel) {
    ui.dialog = {
      title: opts.title || "",
      body: opts.body || "",
      ok: opts.ok || "확인",
      cancel: opts.cancel === null ? null : opts.cancel || "취소",
      input: !!opts.input,
      value: opts.value || "",
      placeholder: opts.placeholder || "",
      maxlength: opts.maxlength || 60,
      onOk: onOk || null,
      onCancel: onCancel || null
    };
    hideSnack();
    render();

    if (!ui.dialog.input) return;
    // 시트가 떠오른 뒤에 커서를 옮긴다
    setTimeout(function () {
      var node = el("dialogValue");
      if (!node) return;
      try {
        node.focus();
        node.select();
      } catch (e) {}
    }, 60);
  }

  /** 알려 주기만 하고 고를 것이 없을 때 */
  function tell(title, body) {
    ask({ title: title, body: body, cancel: null });
  }

  function closeDialog() {
    var d = ui.dialog;
    ui.dialog = null;
    render();
    if (d && d.onCancel) d.onCancel();
  }

  function renderDialog() {
    var d = ui.dialog;
    if (!d) return;
    text("dialogTitle", d.title);
    text("dialogBody", d.body);
    show("dialogHasBody", !!d.body);
    show("dialogHasInput", d.input);
    show("dialogHasCancel", !!d.cancel);

    var okBtn = el("dialogOk");
    if (okBtn) okBtn.textContent = d.ok;
    var cancelBtn = el("dialogCancel");
    if (cancelBtn && d.cancel) cancelBtn.textContent = d.cancel;

    var input = el("dialogValue");
    if (input) {
      input.setAttribute("maxlength", String(d.maxlength));
      input.setAttribute("placeholder", d.placeholder);
      value(input, d.value);
    }
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

  var STRIPES = "repeating-linear-gradient(115deg, var(--fg) 0 0.375rem, var(--g3) 0.375rem 0.6875rem)";

  function tabStyle(name) {
    var on = ui.tab === name;
    return (
      "border:none;background:none;padding:0.25rem 0;font-size:0.84375rem;font-weight:" +
      (on ? "700" : "400") +
      ";color:" + (on ? "var(--fg)" : "var(--g3)")
    );
  }

  function authTabStyle(on) {
    return (
      "border:none;background:none;min-height:2.75rem;padding:0.625rem 2px;font-size:0.9375rem;letter-spacing:-.02em;font-weight:" +
      (on ? "800" : "500") +
      ";color:" + (on ? "var(--fg)" : "var(--g3)") +
      ";border-bottom:2px solid " + (on ? "var(--fg)" : "transparent") +
      ";margin-bottom:-1px"
    );
  }

  function chipStyle(on) {
    return (
      "white-space:nowrap;border-radius:999px;padding:0.4375rem 0.8125rem;font-size:0.75rem;font-weight:600;border:1px solid " +
      (on ? "var(--fg)" : "var(--g2)") +
      ";background:" + (on ? "var(--fg)" : "transparent") +
      ";color:" + (on ? "var(--bg)" : "var(--g3)")
    );
  }

  function checkStyle(checked) {
    return (
      "flex:0 0 auto;width:1.375rem;height:1.375rem;border-radius:0.6875rem;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:800;border:1px solid " +
      (checked ? "var(--fg)" : "var(--g2)") +
      ";background:" + (checked ? "var(--fg)" : "transparent") + ";color:var(--bg)"
    );
  }

  /** 네모 체크 상자 (로그인 유지) */
  function keepBoxStyle(on) {
    return (
      "flex:0 0 auto;width:1.25rem;height:1.25rem;border-radius:0.375rem;display:flex;align-items:center;justify-content:center;font-size:0.6875rem;font-weight:800;border:1px solid " +
      (on ? "var(--fg)" : "var(--g2)") +
      ";background:" + (on ? "var(--fg)" : "transparent") + ";color:var(--bg)"
    );
  }

  function catButtonStyle(selected) {
    return (
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:clamp(2.625rem,6.4dvh,3.75rem);border-radius:0.75rem;padding:2px;border:1px solid " +
      (selected ? "var(--fg)" : "var(--g2)") +
      ";background:" + (selected ? "var(--fg)" : "transparent") +
      ";color:" + (selected ? "var(--bg)" : "var(--fg)")
    );
  }

  function bigButtonStyle(on, extra) {
    return (
      (extra || "") +
      "width:100%;height:3.375rem;border:none;border-radius:0.875rem;font-size:1rem;font-weight:700;background:" +
      (on ? "var(--fg)" : "var(--g1)") + ";color:" + (on ? "var(--bg)" : "var(--g3)")
    );
  }

  /* 시트 안의 주 버튼 (예산·공유 화면) */
  function sheetButtonStyle(on) {
    return (
      "margin-top:0.875rem;width:100%;height:3.125rem;border:none;border-radius:0.8125rem;font-size:0.9375rem;font-weight:700;background:" +
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
      '<span style="font-size:0.6875rem;font-weight:600;color:var(--g3);margin-left:0.375rem">' +
      esc(mine ? "나" : name) + "</span>"
    );
  }

  /* 홈의 오늘 줄. 한 줄에 무엇에 · 누가 · 얼마 — 메모는 이름 뒤에 이어 붙인다. */
  function expenseRowHTML(e, budget) {
    var c = calc.resolveCategory(e, data.categories);
    var title = c.emoji + " " + c.name + (e.memo ? " · " + e.memo : "");
    var who = "";
    if (budget && budget.shared) {
      who = e.uid && e.uid === me().uid ? "나" : calc.memberName(budget, e.uid, e.userName);
    }
    return (
      '<button data-act="editExpense" data-id="' + esc(e.id) +
        '" style="display:flex;align-items:baseline;gap:0.75rem;width:100%;border:none;background:none;padding:0.875rem 0;text-align:left;border-bottom:1px solid var(--g1)">' +
        '<span style="flex:1;min-width:0;font-size:0.90625rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(title) + "</span>" +
        (who ? '<span style="flex:0 0 auto;font-size:0.6875rem;color:var(--g3)">' + esc(who) + "</span>" : "") +
        '<span style="flex:0 0 auto;font-size:0.9375rem;font-weight:600;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</span>" +
      "</button>"
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
    show("dialogOpen", !!ui.dialog);
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
    if (!ready) {
      renderDialog();
      return;
    }

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
    renderDialog();
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
        '" style="display:flex;align-items:center;gap:0.75rem;width:100%;text-align:left;border:none;background:none;padding:0.6875rem 1rem">' +
        '<span style="flex:0 0 auto;width:1.25rem;text-align:center;font-size:0.8125rem;font-weight:800">' +
          (on ? "✓" : "") + "</span>" +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-size:0.9375rem;font-weight:' + (on ? "700" : "600") +
            ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            esc((b.shared ? "👥 " : "") + b.name) + "</span>" +
          '<span style="display:block;font-size:0.6875rem;color:var(--g3);margin-top:0.1875rem">' +
            esc(budgetPeriodText(b) + " · " + calc.formatWon(st.spent) + " / " +
                calc.formatWon(b.totalAmount) + "원") + "</span>" +
        "</span>" +
        '<span style="flex:0 0 auto;font-size:0.625rem;font-weight:700;color:var(--g3)">' +
          esc(budgetStateLabel(b)) + "</span>" +
      "</button>"
    );
  }

  function switcherHeadHTML(label) {
    return '<div style="font-size:0.6875rem;color:var(--g3);padding:0.625rem 1rem 2px">' + esc(label) + "</div>";
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
      : '<button data-act="openPersonal" style="display:flex;align-items:center;gap:0.75rem;width:100%;text-align:left;border:none;background:none;padding:0.6875rem 1rem">' +
          '<span style="flex:0 0 auto;width:1.25rem;text-align:center;font-size:1rem">＋</span>' +
          '<span style="flex:1;min-width:0">' +
            '<span style="display:block;font-size:0.9375rem;font-weight:600">나의 가계부 만들기</span>' +
            '<span style="display:block;font-size:0.6875rem;color:var(--g3);margin-top:0.1875rem">여행과 따로, 달마다 이어지는 가계부</span>' +
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
      btn.style.cssText = bigButtonStyle(!a.busy, "margin-top:1.375rem;");
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
      "flex:0 0 auto;width:2rem;height:2rem;padding:0;border-radius:0.5625rem;display:grid;place-items:center;border:1px solid " +
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
                '<div style="display:flex;align-items:center;gap:0.1875rem">' +
                  '<span style="font-size:0.6875rem;font-weight:' + (isToday ? "800" : "600") + ';' +
                    (isToday
                      ? "background:var(--fg);color:var(--bg);border-radius:0.5625rem;min-width:1.125rem;height:1.125rem;display:inline-flex;align-items:center;justify-content:center;padding:0 0.25rem"
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
                  '<div style="font-size:0.65625rem;font-weight:800;letter-spacing:-.03em;line-height:1.2;word-break:break-all">' +
                    esc(calc.formatWon(day.sum)) + "</div>" +
                  '<div style="font-size:0.625rem;line-height:1.2">' + emojis +
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
                '<div style="display:flex;align-items:center;gap:0.625rem;padding:0.75rem 0;border-top:1px solid var(--g1)">' +
                  '<button data-act="editExpense" data-id="' + esc(e.id) +
                    '" style="flex:1;min-width:0;display:flex;align-items:center;gap:0.6875rem;border:none;background:none;padding:0;text-align:left">' +
                    '<span style="font-size:1.1875rem;width:1.5rem;text-align:center">' + esc(c.emoji) + "</span>" +
                    '<span style="flex:1;min-width:0">' +
                      '<span style="display:block;font-size:0.875rem;font-weight:600">' + esc(c.name) + writerTag(e, view) + "</span>" +
                      (e.memo
                        ? '<span style="display:block;font-size:0.75rem;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</span>"
                        : "") +
                    "</span>" +
                    '<span style="font-size:0.9375rem;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</span>" +
                  "</button>" +
                  '<button data-act="removeExpense" data-id="' + esc(e.id) +
                    '" style="flex:0 0 auto;border:none;background:none;padding:0.375rem 2px;font-size:0.75rem;color:var(--g3)">삭제</button>' +
                "</div>"
              );
            })
            .join("")
        : '<div style="padding:1.625rem 0;text-align:center;font-size:0.8125rem;color:var(--g3)">이 날은 기록이 없습니다</div>'
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
      '<div style="padding-bottom:1.125rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:0.625rem 0 0.25rem">' +
          '<div style="font-size:0.75rem;font-weight:700;color:var(--g3)">' + esc(calc.dayLabel(g.date, today)) + "</div>" +
          '<div style="font-size:0.75rem;color:var(--g3)">' + esc(calc.formatWon(g.sum)) + "원</div>" +
        "</div>" +
        rowsHTML(g, view) +
      "</div>"
    );
  }

  /* 오늘 쓴 것이 제일 궁금하다. 테두리를 둘러 목록에서 먼저 눈에 띄게 한다. */
  function todayGroupHTML(g, view) {
    return (
      '<div style="border:1px solid var(--fg);border-radius:1rem;padding:2px 0.875rem 0.625rem;margin:2px 0 1.25rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:0.8125rem 0 0.4375rem">' +
          '<div style="font-size:0.875rem;font-weight:800;letter-spacing:-.01em">오늘' +
            '<span style="font-size:0.6875rem;font-weight:600;color:var(--g3);margin-left:0.4375rem">' +
              esc(calc.dayLabel(g.date, null)) + "</span></div>" +
          '<div style="font-size:1.1875rem;font-weight:800;letter-spacing:-.03em">' + esc(calc.formatWon(g.sum)) +
            '<span style="font-size:0.75rem;font-weight:600;color:var(--g3);margin-left:2px">원</span></div>' +
        "</div>" +
        rowsHTML(g, view) +
        '<div style="font-size:0.6875rem;color:var(--g3);padding-top:0.5625rem">' + g.items.length + "건</div>" +
      "</div>"
    );
  }

  function swipeRowHTML(e, budget) {
    var c = calc.resolveCategory(e, data.categories);
    return (
      '<div style="position:relative;overflow:hidden;border-top:1px solid var(--g1)">' +
        '<div style="position:absolute;inset:0;display:flex;justify-content:flex-end">' +
          '<button data-act="editExpense" data-id="' + esc(e.id) + '" style="width:4.375rem;border:none;background:var(--g1);font-size:0.8125rem;font-weight:600">수정</button>' +
          '<button data-act="removeExpense" data-id="' + esc(e.id) + '" style="width:4.375rem;border:none;background:var(--fg);color:var(--bg);font-size:0.8125rem;font-weight:600">삭제</button>' +
        "</div>" +
        '<div data-row="' + esc(e.id) + '" class="mm-row" style="position:relative;display:flex;align-items:center;gap:0.75rem;padding:0.8125rem 2px;background:var(--bg);transition:transform .18s ease;touch-action:pan-y;cursor:pointer">' +
          (ui.selMode ? '<div data-check="' + esc(e.id) + '"></div>' : "") +
          '<div style="font-size:1.25rem;width:1.625rem;text-align:center">' + esc(c.emoji) + "</div>" +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:0.875rem;font-weight:600">' + esc(c.name) + writerTag(e, budget) + "</div>" +
            (e.memo
              ? '<div style="font-size:0.75rem;color:var(--g3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.memo) + "</div>"
              : "") +
          "</div>" +
          '<div style="font-size:1rem;font-weight:700;letter-spacing:-.02em">' + esc(calc.formatWon(e.amount)) + "</div>" +
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
      // 뒤에 숨은 수정·삭제 버튼 두 개(4.375rem씩)만큼 밀어낸다
      rows[i].style.transform = open ? "translateX(-8.75rem)" : "translateX(0)";
    }
    var checks = document.querySelectorAll("[data-check]");
    for (var j = 0; j < checks.length; j++) {
      var cid = checks[j].getAttribute("data-check");
      var on = ui.selected.indexOf(cid) >= 0;
      checks[j].style.cssText = checkStyle(on);
      checks[j].textContent = on ? "✓" : "";
    }
  }

  /* 카테고리 색은 슬롯 순서대로만 준다. 여덟 번째부터는 새 색을 만들지 않고
     하나로 묶는다 (색이 많아질수록 서로 구별이 안 되기 때문). */
  var COLOR_SLOTS = 7;

  function categoryColor(rank) {
    return rank < COLOR_SLOTS ? "var(--c" + (rank + 1) + ")" : "var(--c-other)";
  }

  /* 요약의 한 줄. 색점이 도넛 조각과 짝을 이루고, 막대 없이 숫자로 읽는다. */
  function summaryRowHTML(left, pctText, amountText, color) {
    return (
      '<div style="display:flex;align-items:center;gap:0.625rem;padding:0.6875rem 0;border-bottom:1px solid var(--g1)">' +
        (color
          ? '<span style="flex:0 0 auto;width:0.4375rem;height:0.4375rem;border-radius:50%;background:' + color + '"></span>'
          : "") +
        '<span style="flex:1;min-width:0;font-size:0.84375rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(left) + "</span>" +
        (pctText ? '<span style="flex:0 0 auto;font-size:0.6875rem;color:var(--g3)">' + esc(pctText) + "</span>" : "") +
        '<span style="flex:0 0 auto;font-size:0.875rem;font-weight:600;letter-spacing:-.02em">' + esc(amountText) + "</span>" +
      "</div>"
    );
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
          return summaryRowHTML(
            sh.name,
            sh.pct.toFixed(0) + "%",
            calc.formatWon(sh.amount),
            categoryColor(i)
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
      "position:relative;width:12.25rem;height:12.25rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:";
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
          var label = s.uid === me().uid ? s.name + " (나)" : s.name;
          return summaryRowHTML(label, s.pct.toFixed(0) + "%", calc.formatWon(s.amount), "");
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
          return summaryRowHTML(m.fromName + " → " + m.toName, "", calc.formatWon(m.amount), "");
        })
        .join("")
    );
  }

  function renderHome(active) {
    var s = calc.computeBudgetStats(active, data.expenses, today);

    text("homeBudgetName", active.name);
    show("isSharedHome", !!active.shared);
    renderMemberAvatars(active);

    show("hasLimit", s.hasLimit);
    show("noLimit", !s.hasLimit);
    show("isPersonalHome", calc.isPersonal(active));

    text("mainLabel", s.hasLimit ? "남은 금액" : "쓴 돈");
    text("remainingText", calc.formatWon(s.hasLimit ? s.remaining : s.spent));
    text("spentText", calc.formatWon(s.spent));
    text("totalText", calc.formatWon(s.total));

    css(
      "gauge",
      "height:0.625rem;border-radius:0.3125rem;width:" + s.spentPct.toFixed(2) + "%;background:" +
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

    text("todayListTitle", pickDate === today ? "오늘" : calc.dayLabel(pickDate, today));
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

  /**
   * 함께 쓰는 사람 — 이름 첫 글자를 담은 동그라미를 겹쳐 놓는다.
   * 글자는 회색 설명 하나로 줄이고, 누구인지는 동그라미가 말하게 한다.
   * 첫 글자만으로는 알기 어려울 수 있어 전체 이름은 버튼 설명에 남긴다.
   */
  function renderMemberAvatars(budget) {
    var stack = calc.memberInitials(budget, me().uid);
    var btn = el("memberButton");
    if (btn) {
      var full = calc.memberNames(budget, me().uid, 20);
      btn.setAttribute("aria-label", "함께 쓰는 사람 " + full + ". 눌러서 관리");
      btn.setAttribute("title", full);
    }

    var chips = stack.people.map(function (p, i) {
      return avatarHTML(p.initial, i > 0, p.isMe);
    });
    if (stack.more > 0) chips.push(avatarHTML("+" + stack.more, true, false));
    html(el("memberAvatars"), chips.join(""));
  }

  function avatarHTML(label, overlap, mine) {
    return (
      '<span style="width:1.375rem;height:1.375rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:700;letter-spacing:-.02em;' +
        // 겹쳐 놓되 배경색 링을 둘러 서로 떨어져 보이게 한다
        "box-shadow:0 0 0 2px var(--bg);" +
        (overlap ? "margin-left:-0.375rem;" : "") +
        (mine ? "background:var(--fg);color:var(--bg);" : "background:var(--g1);color:var(--g3);") +
      '">' + esc(label) + "</span>"
    );
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
              '<div style="font-size:1.3125rem;line-height:1.1">' + esc(c.emoji) + "</div>" +
              '<div style="font-size:0.59375rem;font-weight:600;line-height:1.15;text-align:center;word-break:keep-all">' + esc(c.name) + "</div>" +
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
          '" style="height:clamp(2.125rem,6.6dvh,3.625rem);border:none;background:none;font-size:1.5rem;font-weight:600;border-radius:0.75rem">' +
          esc(k) + "</button>"
        );
      }).join("")
    );

    var canSave = calc.isValidAmount(d.amount) && !!d.categoryId;
    var saveBtn = el("save");
    saveBtn.disabled = !canSave;
    saveBtn.style.cssText =
      "flex:1;height:clamp(2.75rem,7dvh,3.5rem);border:none;border-radius:0.875rem;font-size:1.0625rem;font-weight:700;background:" +
      (canSave ? "var(--fg)" : "var(--g1)") + ";color:" + (canSave ? "var(--bg)" : "var(--g3)");

    // 원래 뜻은 clamp(30px, 6dvh, 50px). 화면 높이를 기준 화면 단위로 바꿔서 잰다.
    var base = Math.min(50, Math.max(30, (window.innerHeight / scale()) * 0.06));
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
      "margin-top:1rem;width:100%;height:3.25rem;border:none;border-radius:0.8125rem;font-size:1rem;font-weight:700;background:" +
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
            '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.8125rem 0;border-top:1px solid var(--g1)">' +
              '<button data-act="activateBudget" data-id="' + esc(b.id) + '" style="flex:1;min-width:0;text-align:left;border:none;background:none;padding:0">' +
                '<div style="font-size:0.875rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                  esc((b.shared ? "👥 " : "") + b.name) + "</div>" +
                '<div style="font-size:0.6875rem;color:var(--g3);margin-top:0.1875rem">' +
                  esc(calc.periodLabel(b) + " · " + calc.formatWon(st.spent) + " / " + calc.formatWon(b.totalAmount)) + "원</div>" +
              "</button>" +
              '<div style="font-size:0.6875rem;color:var(--g3);flex:0 0 auto">' + state + "</div>" +
              '<button data-act="' + (mine ? "removeBudget" : "leaveBudgetFromList") + '" data-id="' + esc(b.id) +
                '" style="border:none;background:none;padding:0 2px;font-size:0.75rem;color:var(--g3);flex:0 0 auto">' +
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
            '<div data-cat="' + esc(c.id) + '" style="display:flex;align-items:center;gap:0.625rem;padding:0.5625rem 0;border-top:1px solid var(--g1)">' +
              '<input data-catfield="emoji" data-id="' + esc(c.id) + '" maxlength="4" style="width:2.5rem;flex:0 0 auto;border:none;font-size:1.1875rem;text-align:center;outline:none" />' +
              '<input data-catfield="name" data-id="' + esc(c.id) + '" maxlength="20" style="flex:1;min-width:0;border:none;font-size:0.875rem;font-weight:600;outline:none" />' +
              '<button data-act="catUp" data-id="' + esc(c.id) + '" style="width:1.875rem;height:1.875rem;flex:0 0 auto;border:1px solid var(--g2);border-radius:0.5rem;background:none;font-size:0.6875rem">↑</button>' +
              '<button data-act="catDown" data-id="' + esc(c.id) + '" style="width:1.875rem;height:1.875rem;flex:0 0 auto;border:1px solid var(--g2);border-radius:0.5rem;background:none;font-size:0.6875rem">↓</button>' +
              '<button data-act="catRemove" data-id="' + esc(c.id) + '" style="width:1.875rem;height:1.875rem;flex:0 0 auto;border:none;background:none;font-size:0.75rem;color:var(--g3)">✕</button>' +
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
      "width:3.5rem;flex:0 0 auto;border:none;border-radius:0.625rem;font-size:0.875rem;font-weight:700;background:" +
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
            '<div style="display:flex;align-items:center;gap:0.625rem;padding:0.6875rem 0;border-top:1px solid var(--g1)">' +
              '<div style="flex:1;min-width:0;font-size:0.84375rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(name) + "</div>" +
              (tags.length ? '<div style="font-size:0.6875rem;color:var(--g3);flex:0 0 auto">' + esc(tags.join(" · ")) + "</div>" : "") +
              (owner && u !== me().uid
                ? '<button data-act="kickMember" data-id="' + esc(u) + '" style="border:none;background:none;padding:0 2px;font-size:0.75rem;color:var(--g3);flex:0 0 auto">내보내기</button>'
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
    /* --- 확인창 --- */
    dialogCancel: closeDialog,
    dialogOk: function () {
      var d = ui.dialog;
      if (!d) return;
      var input = el("dialogValue");
      var typed = d.input && input ? input.value || "" : "";
      ui.dialog = null;
      render();
      if (d.onOk) d.onOk(typed);
    },

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
      closeSheets();
      ask(
        {
          title: "로그아웃할까요?",
          body: "기록은 계정에 저장돼 있어서 다시 로그인하면 그대로 보입니다.",
          ok: "로그아웃"
        },
        function () {
          auth.signOut().catch(function (err) {
            snack(auth.messageOf(err), null);
            render();
          });
        }
      );
    },
    renameMe: function () {
      closeSheets(); // 확인창 뒤에 메뉴가 열린 채로 남지 않게
      ask(
        {
          title: "이름 바꾸기",
          body: "함께 쓸 때 다른 사람에게 이 이름이 보입니다.",
          input: true,
          value: me().name || "",
          placeholder: "이름",
          maxlength: model.MAX_NAME,
          ok: "저장"
        },
        function (next) {
          if (!next.trim()) return;
          renameTo(next);
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
    goHome: function () { setTab("home"); },
    goHistory: function () { setTab("history"); },
    goSummary: function () { setTab("summary"); },
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
        ? "\n함께 쓰는 예산이라 다른 사람이 적은 내역도 함께 지워집니다."
        : "";
      ask(
        {
          title: "내역을 모두 지울까요?",
          body: '"' + view.name + '"에 적은 지출 ' + ids.length + "건이 사라집니다." + warn,
          ok: "모두 삭제"
        },
        function () {
          removeMany(ids, ids.length + "건 삭제됨");
        }
      );
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
      var lines = [];
      if (n > 0) lines.push("여기 적은 지출 " + n + "건도 함께 사라집니다.");
      if (others > 0) lines.push("함께 쓰는 " + others + "명의 화면에서도 없어집니다.");
      lines.push("되돌릴 수 없습니다.");
      ask(
        { title: '"' + b.name + '" 예산을 지울까요?', body: lines.join("\n"), ok: "삭제" },
        function () {
          store.removeBudget(id);
          render();
        }
      );
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
      var go = function () {
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
      };
      if (!b.inviteCode) return go();
      ask(
        {
          title: "코드를 새로 만들까요?",
          body: "지금 코드는 바로 못 쓰게 됩니다. 이미 들어와 있는 사람은 그대로 함께 씁니다.",
          ok: "새로 만들기"
        },
        go
      );
    },
    stopInvites: function () {
      var b = shareTarget();
      if (!b) return;
      ask(
        {
          title: "초대를 끌까요?",
          body: "새로 들어올 수 없게 됩니다. 이미 들어와 있는 사람은 그대로 함께 씁니다.",
          ok: "초대 끄기"
        },
        function () {
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
        }
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
      ask(
        {
          title: '"' + name + '"님을 내보낼까요?',
          body: "적어 둔 내역은 그대로 남습니다.",
          ok: "내보내기"
        },
        function () {
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
        }
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
        tell("카테고리는 하나는 있어야 합니다", "마지막 하나는 지울 수 없습니다.");
        return;
      }
      var n = model.categoryUsageCount(data, id);
      ask(
        {
          title: '"' + c.name + '" 카테고리를 지울까요?',
          body: n > 0
            ? "이 카테고리로 적은 지출 " + n + "건은 그대로 남고, 이름도 계속 보입니다."
            : "",
          ok: "삭제"
        },
        function () {
          store.removeCategory(id);
          render();
        }
      );
    },

    toggleTheme: function () {
      uiTheme = uiTheme === "dark" ? "light" : "dark";
      store.setTheme(uiTheme);
      ui.menuOpen = false;
      render();
    }
  };

  /* ---------- 탭 이동 ---------- */

  var TABS = ["home", "history", "summary"];

  /**
   * 탭을 바꾼다. 어느 쪽에서 넘어왔는지 짧게 보여 준다.
   * 탭을 눌러서 오든 스와이프로 오든 같은 길을 쓴다.
   */
  function setTab(name) {
    if (ui.tab === name) return;
    var step = TABS.indexOf(name) - TABS.indexOf(ui.tab);
    ui.tab = name;
    ui.swipedId = null;
    ui.selMode = false;
    ui.selected = [];
    slideTab(step);
    render();
  }

  /** 옆 탭으로. 양 끝에서는 넘어가지 않는다 (돌아 나오지 않는다) */
  function stepTab(step) {
    var i = TABS.indexOf(ui.tab);
    if (i < 0) return false;
    var next = i + step;
    if (next < 0 || next >= TABS.length) return false;
    setTab(TABS[next]);
    return true;
  }

  function slideTab(step) {
    var node = el("scroller");
    if (!node || !step) return;
    node.classList.remove("mm-in-left", "mm-in-right");
    // 같은 방향으로 연달아 넘겨도 애니메이션이 다시 돌게 한 번 재계산시킨다
    if (node.offsetWidth) {
      /* 값을 읽는 것 자체가 목적이다 */
    }
    node.classList.add(step > 0 ? "mm-in-right" : "mm-in-left");
  }

  /* ---------- 좌우 스와이프로 탭 넘기기 ---------- */

  var SWIPE_MIN = 60;      // 이만큼은 가로로 움직여야 넘긴다
  var SWIPE_RATIO = 1.6;   // 세로보다 이만큼 더 가로여야 한다
  var swipeTab = { live: false, x: 0, y: 0, onRow: false };
  var swallowClickUntil = 0;

  function canSwipeTab() {
    if (!appReady() || !activeBudget()) return false;
    if (ui.addOpen || ui.menuOpen || ui.budgetOpen || ui.catsOpen || ui.shareOpen) return false;
    if (ui.switcherOpen || ui.personalOpen || ui.dayOpen || ui.dialog) return false;
    if (ui.selMode) return false;  // 고르는 중에는 화면을 바꾸지 않는다
    if (ui.swipedId) return false; // 열려 있는 줄부터 닫는 게 먼저다
    return true;
  }

  function installTabSwipe(host) {
    if (!host) return;

    host.addEventListener("touchstart", function (ev) {
      swipeTab.live = false;
      if (ev.touches.length !== 1 || !canSwipeTab()) return;
      swipeTab.live = true;
      swipeTab.x = ev.touches[0].clientX;
      swipeTab.y = ev.touches[0].clientY;
      // 지출 줄에서 시작한 가로 스와이프는 그 줄의 수정·삭제용이다
      swipeTab.onRow = !!(ev.target.closest && ev.target.closest("[data-row]"));
    }, { passive: true });

    host.addEventListener("touchmove", function (ev) {
      // 손가락이 하나 더 얹히면(확대 등) 우리 동작이 아니다
      if (swipeTab.live && ev.touches.length !== 1) swipeTab.live = false;
    }, { passive: true });

    host.addEventListener("touchend", function (ev) {
      var live = swipeTab.live && !swipeTab.onRow;
      swipeTab.live = false;
      if (!live || ev.touches.length) return;

      var t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - swipeTab.x;
      var dy = t.clientY - swipeTab.y;
      if (Math.abs(dx) < SWIPE_MIN) return;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return; // 세로에 가까우면 스크롤이다

      // 왼쪽으로 밀면 오른쪽 탭, 오른쪽으로 밀면 왼쪽 탭
      if (stepTab(dx < 0 ? 1 : -1)) {
        // 같은 손짓의 끝을 브라우저가 탭으로 흘리는 경우만 막는다.
        // 길게 잡으면 스와이프 직후의 진짜 탭까지 먹으므로 짧게 둔다.
        swallowClickUntil = Date.now() + 150;
      }
    }, { passive: true });

    host.addEventListener("touchcancel", function () {
      swipeTab.live = false;
    }, { passive: true });
  }

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
    ask(
      {
        title: '"' + b.name + '"에서 나갈까요?',
        body: "내가 적은 내역은 남습니다. 다시 들어오려면 초대 코드가 필요합니다.",
        ok: "나가기"
      },
      function () {
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
    );
  }

  /** 이름 바꾸기 — 확인창에서 받은 값을 실제로 반영한다 */
  function renameTo(next) {
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
  }

  document.addEventListener("click", function (ev) {
    // 방금 화면을 넘겼다면 그 손짓의 끝을 클릭으로 받지 않는다
    if (Date.now() < swallowClickUntil) {
      ev.preventDefault();
      return;
    }
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

  document.addEventListener("keydown", function (ev) {
    /* 확인창이 떠 있으면 키는 확인창의 것이다 */
    if (ui.dialog) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeDialog();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        ACTIONS.dialogOk();
      }
      return;
    }

    /* 엔터로 로그인 / 참여 */
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
    ask(
      {
        title: "예전 기록을 옮길까요?",
        body:
          "로그인 전에 이 기기에서 쓰던 기록이 있습니다.\n예산 " +
          old.budgets.length + "개, 지출 " + n + "건.",
        ok: "옮기기",
        cancel: "그냥 두기"
      },
      function () {
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
      },
      function () {
        store.skipLegacy(); // "그냥 두기"를 골랐으면 다시 묻지 않는다
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
    scaleCache = null; // 화면이 바뀌었으니 배율을 다시 잰다
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

  /* 홈 · 내역 · 요약을 좌우로 넘긴다 */
  installTabSwipe(el("frame"));

  /* 웹앱에는 주소창이 없다 — 위에서 아래로 당기면 새로고침 */
  MP.pullToRefresh.install({
    host: el("frame"),
    scroller: function () {
      return appReady() && activeBudget() ? el("scroller") : null;
    },
    canPull: function () {
      if (ui.addOpen || ui.menuOpen || ui.budgetOpen || ui.catsOpen || ui.shareOpen) return false;
      if (ui.switcherOpen || ui.personalOpen || ui.dayOpen || ui.dialog) return false;
      if (ui.selMode || ui.swipedId) return false;
      var s = auth.state().status;
      return s === "signed-in" || s === "signed-out";
    },
    onEngage: clearTouch,
    onRefresh: doRefresh
  });
})();
