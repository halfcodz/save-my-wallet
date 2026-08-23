/* smoke.js — 실제 index.html + 앱 스크립트를 jsdom에서 구동한다.
   Firebase는 메모리 가짜로 대체해서, 화면 흐름과 데이터 흐름만 검증한다.

   실행: node js/smoke.node.js
   (jsdom 이 필요하다: npm i jsdom  — 앱 자체는 의존성이 없다) */

const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  console.log(
    "jsdom 이 없습니다. 이 검증만 브라우저 흉내가 필요합니다.\n" +
      "  npm i jsdom\n" +
      "설치하기 싫으면 건너뛰어도 됩니다. 계산·데이터 검증은 다음으로 충분합니다.\n" +
      "  node js/run-tests.node.js"
  );
  process.exit(0);
}

const ROOT = process.argv[2] || path.join(__dirname, "..");
const results = [];
function ok(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: cond ? "" : extra || "" });
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

/* ================= 가짜 Firestore ================= */

function makeFake() {
  const docs = new Map(); // path -> data
  const docSubs = new Map(); // path -> Set(cb)
  const querySubs = []; // {path, field, value, cb}
  let auto = 0;
  const SENT = Symbol("sentinel");

  const FieldValue = {
    arrayUnion: (...v) => ({ [SENT]: "arrayUnion", v }),
    arrayRemove: (...v) => ({ [SENT]: "arrayRemove", v }),
    delete: () => ({ [SENT]: "delete" })
  };

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function snapOf(p) {
    const d = docs.get(p);
    return { exists: d !== undefined, id: p.split("/").pop(), data: () => clone(d) };
  }
  function childrenOf(colPath) {
    const out = [];
    for (const [p] of docs) {
      if (!p.startsWith(colPath + "/")) continue;
      if (p.slice(colPath.length + 1).includes("/")) continue;
      out.push(p);
    }
    return out;
  }
  function querySnap(q) {
    let paths = childrenOf(q.path);
    if (q.field) {
      paths = paths.filter((p) => {
        const v = docs.get(p)[q.field];
        return Array.isArray(v) && v.includes(q.value);
      });
    }
    return { docs: paths.map(snapOf) };
  }

  let pending = 0;
  function notify() {
    pending++;
    Promise.resolve().then(() => {
      pending--;
      for (const [p, set] of docSubs) for (const cb of set) cb(snapOf(p));
      for (const q of querySubs) q.cb(querySnap(q));
    });
  }

  function applyPatch(target, patch) {
    for (const key of Object.keys(patch)) {
      const val = patch[key];
      const parts = key.split(".");
      let node = target;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (val && val[SENT] === "delete") delete node[last];
      else if (val && val[SENT] === "arrayUnion") {
        const cur = Array.isArray(node[last]) ? node[last] : [];
        node[last] = cur.concat(val.v.filter((x) => !cur.includes(x)));
      } else if (val && val[SENT] === "arrayRemove") {
        const cur = Array.isArray(node[last]) ? node[last] : [];
        node[last] = cur.filter((x) => !val.v.includes(x));
      } else node[last] = clone(val);
    }
  }

  function docRef(p) {
    return {
      id: p.split("/").pop(),
      path: p,
      collection: (name) => colRef(p + "/" + name),
      get: () => Promise.resolve(snapOf(p)),
      set: (data, opts) => {
        const base = opts && opts.merge ? docs.get(p) || {} : {};
        applyPatch(base, data);
        docs.set(p, base);
        notify();
        return Promise.resolve();
      },
      update: (patch) => {
        if (!docs.has(p)) return Promise.reject(Object.assign(new Error("no doc"), { code: "not-found" }));
        const base = docs.get(p);
        applyPatch(base, patch);
        notify();
        return Promise.resolve();
      },
      delete: () => {
        docs.delete(p);
        notify();
        return Promise.resolve();
      },
      onSnapshot: (next) => {
        if (!docSubs.has(p)) docSubs.set(p, new Set());
        docSubs.get(p).add(next);
        Promise.resolve().then(() => next(snapOf(p)));
        return () => docSubs.get(p).delete(next);
      }
    };
  }

  function colRef(p, filter) {
    return {
      doc: (id) => docRef(p + "/" + (id || "auto" + ++auto)),
      where: (field, op, value) => colRef(p, { field, value }),
      get: () => Promise.resolve(querySnap({ path: p, ...(filter || {}) })),
      onSnapshot: (next) => {
        const q = { path: p, ...(filter || {}), cb: next };
        querySubs.push(q);
        Promise.resolve().then(() => next(querySnap(q)));
        return () => {
          const i = querySubs.indexOf(q);
          if (i >= 0) querySubs.splice(i, 1);
        };
      }
    };
  }

  const db = {
    collection: (name) => colRef(name),
    enablePersistence: () => Promise.resolve(),
    waitForPendingWrites: () => Promise.resolve(),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: () => Promise.all(ops.map((f) => f())).then(() => undefined)
      };
    }
  };

  /* ---- auth ---- */
  let current = null;
  let authCb = null;
  const users = new Map();

  let persistence = null; // 마지막으로 요청된 로그인 유지 방식
  const auth = {
    get currentUser() {
      return current;
    },
    get lastPersistence() {
      return persistence;
    },
    setPersistence: (mode) => {
      persistence = mode;
      return Promise.resolve();
    },
    onAuthStateChanged: (next) => {
      authCb = next;
      Promise.resolve().then(() => next(current));
      return () => {};
    },
    createUserWithEmailAndPassword: (email, password) => {
      if (users.has(email)) return Promise.reject({ code: "auth/email-already-in-use" });
      const u = {
        uid: "uid_" + (users.size + 1),
        email,
        displayName: null,
        updateProfile(p) {
          Object.assign(this, p);
          return Promise.resolve();
        }
      };
      users.set(email, { password, u });
      current = u;
      if (authCb) Promise.resolve().then(() => authCb(current));
      return Promise.resolve({ user: u });
    },
    signInWithEmailAndPassword: (email, password) => {
      const rec = users.get(email);
      if (!rec || rec.password !== password) return Promise.reject({ code: "auth/invalid-credential" });
      current = rec.u;
      if (authCb) Promise.resolve().then(() => authCb(current));
      return Promise.resolve({ user: rec.u });
    },
    signOut: () => {
      current = null;
      if (authCb) Promise.resolve().then(() => authCb(null));
      return Promise.resolve();
    },
    sendPasswordResetEmail: () => Promise.resolve()
  };

  const firebase = {
    apps: [],
    initializeApp(cfg) {
      firebase.apps.push({ cfg });
      return { cfg };
    },
    app: () => firebase.apps[0],
    auth: Object.assign(() => auth, {
      Auth: { Persistence: { LOCAL: "local", SESSION: "session", NONE: "none" } }
    }),
    firestore: Object.assign(() => db, { FieldValue })
  };

  return { firebase, docs, db, authApi: auth, snapOf, childrenOf };
}

/* ================= 구동 ================= */

async function tick(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/* 실제 시간이 흘러야 하는 것(포커스 이동 등)을 기다린다 */
async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

(async function main() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://example.test/",
    pretendToBeVisual: true
  });
  const win = dom.window;
  const doc = win.document;

  // 브라우저 기본 창을 부르면 바로 잡히도록 덫을 놓는다
  const nativeCalls = [];
  win.confirm = (m) => { nativeCalls.push("confirm: " + m); return true; };
  win.alert = (m) => { nativeCalls.push("alert: " + m); };
  win.prompt = (m) => { nativeCalls.push("prompt: " + m); return "새이름"; };

  const fake = makeFake();
  win.firebase = fake.firebase;
  win.MP_FIREBASE_CONFIG = {
    apiKey: "test-key",
    authDomain: "t.firebaseapp.com",
    projectId: "t",
    storageBucket: "t.appspot.com",
    messagingSenderId: "1",
    appId: "1:1:web:1"
  };

  const errors = [];
  win.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  const files = ["calc.js", "model.js", "auth.js", "store.js", "refresh.js", "app.js"];
  for (const f of files) {
    try {
      win.eval(fs.readFileSync(path.join(ROOT, "js", f), "utf8"));
    } catch (e) {
      errors.push(f + ": " + e.message + "\n" + e.stack);
    }
  }
  ok("앱 스크립트가 오류 없이 로드된다", errors.length === 0, errors.join("\n"));
  if (errors.length) return report();

  const visible = (name) => {
    const n = doc.querySelector(`[data-show="${name}"]`);
    return !!n && !n.classList.contains("mm-hide");
  };
  const el = (name) => doc.querySelector(`[data-el="${name}"]`);
  const txt = (name) => (el(name) ? el(name).textContent : null);
  const click = (sel) => {
    const n = typeof sel === "string" ? doc.querySelector(sel) : sel;
    if (!n) throw new Error("클릭 대상 없음: " + sel);
    n.dispatchEvent(new win.Event("click", { bubbles: true }));
  };
  const type = (name, v) => {
    const n = el(name);
    n.value = v;
    n.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  // blur 는 버블링하지 않지만, document 의 캡처 리스너에는 잡힌다
  const blur = (name) => el(name).dispatchEvent(new win.Event("blur"));
  const dialogOpen = () => visible("dialogOpen");

  /* 손가락으로 미는 흉내. from 을 주면 그 요소에서 시작한다. */
  const drag = async (dx, dy, from) => {
    const node = from || el("scroller");
    const at = (x, y) => ({ clientX: x, clientY: y });
    const start = new win.Event("touchstart", { bubbles: true });
    start.touches = [at(200, 400)];
    start.changedTouches = start.touches;
    node.dispatchEvent(start);

    const end = new win.Event("touchend", { bubbles: true });
    end.touches = [];
    end.changedTouches = [at(200 + dx, 400 + dy)];
    node.dispatchEvent(end);
    await tick(6);
  };
  // 날짜는 오늘을 기준으로 잡는다. 고정 날짜를 쓰면 그 기간이 지나는 순간 깨진다.
  const C = win.MP.calc;
  const todayIso = C.todayISO();
  const tripStart = C.addDays(todayIso, -3);
  const tripEnd = C.addDays(todayIso, 1);
  const tripPeriod = C.periodLabel({ startDate: tripStart, endDate: tripEnd });
  const month = C.monthBounds(todayIso);
  const monthPeriod = C.periodLabel({ startDate: month.start, endDate: month.end });

  const currentTab = () =>
    visible("isHome") ? "home"
    : visible("isHistory") ? "history"
    : visible("isSummary") ? "summary"
    : "?";
  const swipeLeft = (from) => drag(-90, 0, from);   // 다음 탭
  const swipeRight = (from) => drag(90, 0, from);   // 이전 탭
  const acceptDialog = async () => {
    click('[data-act="dialogOk"]');
    await tick(8);
  };
  const errorText = () => (visible("authError") ? txt("authErrorText") : "");

  await tick();

  /* --- 1. 로그인 화면 --- */
  ok("처음엔 로그인 화면이 뜬다", visible("authForm"));
  ok("설정 안내는 안 뜬다 (설정이 채워져 있으므로)", !visible("authSetup"));
  ok("가계부 본문은 아직 안 보인다", !visible("hasBudget") && !visible("noBudget"));

  eq("로그인 화면 제목", txt("authTitle"), "환영합니다");
  ["authEmail", "authPassword", "authName"].forEach((n) => {
    ok(`${n} 에 힌트(placeholder)가 없다`, !el(n).getAttribute("placeholder"));
  });

  /* --- 2. 형식 검사 --- */
  click('[data-act="authModeSignup"]');
  await tick(2);
  ok("회원가입 탭에서 이름 칸이 보인다", visible("isSignup"));
  eq("회원가입 화면 제목", txt("authTitle"), "가계부를 시작합니다");
  ok("아직 지적은 없다", !visible("authError"));

  // 빈 채로 눌러도 버튼은 눌리고, 무엇이 빠졌는지 알려 준다
  ok("빈 값이어도 버튼은 눌린다", el("authSubmit").disabled === false);
  click('[data-act="authSubmit"]');
  await tick(3);
  ok("빈 채로 누르면 이름부터 지적한다", errorText().includes("이름"), errorText());

  // 이메일 형식
  type("authName", "지민");
  await tick(2);
  ok("고치기 시작하면 지적이 사라진다", !visible("authError"));
  click('[data-act="authSubmit"]');
  await tick(3);
  ok("이름을 채우면 다음은 이메일을 지적한다", errorText().includes("이메일"), errorText());

  type("authEmail", "a@b");
  blur("authEmail");
  await tick(3);
  ok("칸을 벗어나면 이메일 형식을 바로 지적한다", errorText().includes("형식"), errorText());
  ok("올바른 예시를 보여 준다", errorText().includes("name@example.com"), errorText());

  type("authEmail", "지민 골뱅이 test.com");
  blur("authEmail");
  await tick(3);
  ok("@ 가 없어도 지적한다", errorText().includes("형식"), errorText());

  // 비밀번호 길이
  type("authEmail", "a@test.com");
  blur("authEmail");
  await tick(3);
  ok("올바른 이메일에는 지적이 없다", !visible("authError"), errorText());

  type("authPassword", "abc");
  blur("authPassword");
  await tick(3);
  ok("짧은 비밀번호를 지적한다", errorText().includes("6자"), errorText());
  ok("지금 몇 자인지도 알려 준다", errorText().includes("3자"), errorText());

  type("authPassword", "secret1");
  blur("authPassword");
  await tick(3);
  ok("길이를 채우면 지적이 사라진다", !visible("authError"), errorText());

  /* --- 2.5 로그인 유지 --- */
  eq("로그인 유지는 기본으로 켜져 있다", txt("keepBox"), "✓");
  ok("켜져 있으면 그 뜻을 설명한다", txt("keepHint").includes("로그인된 상태"), txt("keepHint"));

  click('[data-act="toggleKeepSignedIn"]');
  await tick(3);
  eq("누르면 꺼진다", txt("keepBox"), "");
  ok("꺼졌을 때의 뜻도 설명한다", txt("keepHint").includes("로그아웃"), txt("keepHint"));
  eq("설정이 기기에 남는다", win.localStorage.getItem("moneyplan.keepSignedIn"), "0");
  eq("끄면 세션 유지로 바뀐다", fake.authApi.lastPersistence, "session");

  click('[data-act="toggleKeepSignedIn"]');
  await tick(3);
  eq("다시 누르면 켜진다", txt("keepBox"), "✓");
  eq("켜면 기기 유지로 돌아온다", fake.authApi.lastPersistence, "local");

  /* --- 3. 회원가입 --- */
  click('[data-act="authSubmit"]');
  await tick(12);
  eq("가입할 때도 유지 설정이 적용된다", fake.authApi.lastPersistence, "local");

  ok("가입 후 로그인 화면이 사라진다", !visible("authForm"));
  ok("예산이 없으니 시작 화면이 뜬다", visible("noBudget"), "authLoading=" + visible("authLoading"));
  eq("사용자 문서가 만들어진다", !!fake.docs.get("users/uid_1"), true);
  eq("기본 카테고리 14개가 계정에 저장된다", fake.docs.get("users/uid_1").categories.length, 14);
  eq("표시 이름이 저장된다", fake.docs.get("users/uid_1").displayName, "지민");

  /* --- 4. 예산 만들기 --- */
  click('[data-act="openBudget"]');
  await tick(2);
  ok("예산 시트가 열린다", visible("budgetOpen"));

  type("nbName", "부산 여행");
  type("nbStart", tripStart);
  type("nbEnd", tripEnd);
  type("nbTotal", "400000");
  await tick(2);
  ok("입력이 유효하면 만들기 버튼이 켜진다", el("createBudget").disabled === false);

  click('[data-act="createBudget"]');
  await tick(10);

  ok("예산이 생기면 본문이 보인다", visible("hasBudget"));
  const budgetPath = [...fake.docs.keys()].find((k) => k.startsWith("budgets/") && k.split("/").length === 2);
  ok("예산 문서가 만들어진다", !!budgetPath);
  const budget = fake.docs.get(budgetPath);
  eq("예산 이름", budget.name, "부산 여행");
  eq("총액", budget.totalAmount, 400000);
  eq("만든 사람이 주인", budget.ownerUid, "uid_1");
  eq("멤버는 나 혼자", budget.memberUids.length, 1);
  eq("초대 코드는 아직 없음", budget.inviteCode, null);
  eq("남은 금액이 총액과 같다", txt("remainingText"), "400,000");

  /* --- 4. 지출 입력 --- */
  click('[data-act="openAdd"]');
  await tick(3);
  ok("입력 화면이 열린다", visible("addOpen"));

  ["1", "2", "0", "00"].forEach((k) => click(`[data-act="key"][data-key="${k}"]`));
  await tick(2);
  eq("키패드로 찍은 금액", txt("draftAmountText"), "12,000");

  click('[data-act="pickCat"]');
  await tick(2);
  ok("카테고리를 고르면 저장 버튼이 켜진다", el("save").disabled === false);

  click('[data-act="save"]');
  await tick(10);

  ok("저장하면 입력 화면이 닫힌다", !visible("addOpen"));
  const expPaths = fake.childrenOf(budgetPath + "/expenses");
  eq("지출 문서가 1건 생긴다", expPaths.length, 1);
  const saved = fake.docs.get(expPaths[0]);
  eq("금액", saved.amount, 12000);
  eq("누가 썼는지 기록된다", saved.uid, "uid_1");
  eq("작성자 이름도 기록된다", saved.userName, "지민");
  ok("카테고리 이름이 함께 박힌다", !!saved.categoryName);
  eq("남은 금액이 줄어든다", txt("remainingText"), "388,000");
  eq("오늘 쓴 돈에 반영된다", txt("todaySpentText"), "12,000");
  ok("되돌리기 스낵바가 뜬다", visible("snackOpen") && visible("snackUndo"));

  /* --- 5. 되돌리기 --- */
  click('[data-act="undo"]');
  await tick(10);
  eq("되돌리면 지출이 사라진다", fake.childrenOf(budgetPath + "/expenses").length, 0);
  eq("남은 금액도 되돌아온다", txt("remainingText"), "400,000");

  // 다시 한 건 넣어 둔다 (뒤 단계에서 쓴다)
  click('[data-act="openAdd"]');
  await tick(3);
  ["3", "0", "0", "00"].forEach((k) => click(`[data-act="key"][data-key="${k}"]`));
  click('[data-act="pickCat"]');
  await tick(2);
  click('[data-act="save"]');
  await tick(10);
  eq("다시 넣은 금액", txt("remainingText"), "370,000");

  /* --- 5.5 예산 고르기 시트 --- */
  eq("상단에 지금 예산 이름이 보인다", txt("homeBudgetName"), "부산 여행");

  click('[data-act="openSwitcher"]');
  await tick(4);
  ok("메인 제목을 누르면 예산 고르기가 열린다", visible("switcherOpen"));
  ok("지금 예산에 체크가 있다", el("switcherList").textContent.includes("✓"));
  ok("예산 이름이 나온다", el("switcherList").textContent.includes("부산 여행"));
  ok("기간과 쓴 금액도 같이 보인다", el("switcherList").textContent.includes(tripPeriod));
  ok("나의 가계부 구역이 있다", el("switcherList").textContent.includes("나의 가계부"));
  ok("아직 없으면 만들기를 권한다", el("switcherList").textContent.includes("나의 가계부 만들기"));
  ok("여행 구역으로 나뉜다", el("switcherList").textContent.includes("여행"));
  ok("진행 중 표시가 붙는다", el("switcherList").textContent.includes("진행 중"));

  // 여기서 곧장 새 예산으로 갈 수 있다
  click('[data-el="switcherSheet"] [data-act="newBudget"]');
  await tick(4);
  ok("새 예산 만들기로 바로 넘어간다", visible("budgetOpen"));
  ok("예산 고르기는 닫힌다", !visible("switcherOpen"));
  click('[data-act="closeBudget"]');
  await tick(3);

  // 여행 참여로도 갈 수 있다
  click('[data-act="openSwitcher"]');
  await tick(3);
  click('[data-el="switcherSheet"] [data-act="joinTrip"]');
  await tick(6);
  ok("초대 코드 참여로 바로 넘어간다", visible("shareOpen"));
  ok("예산 고르기는 닫힌다", !visible("switcherOpen"));
  await wait(150); // 시트가 올라온 뒤 커서가 옮겨간다
  eq(
    "코드 칸에 커서가 가 있다",
    doc.activeElement && doc.activeElement.getAttribute("data-el"),
    "joinCode"
  );
  click('[data-act="closeShare"]');
  await tick(3);

  // 두 번째 예산을 만들어 전환을 확인한다
  click('[data-act="newBudget"]');
  await tick(4);
  type("nbName", "생활비");
  type("nbStart", month.start);
  type("nbEnd", month.end);
  type("nbTotal", "500000");
  await tick(2);
  click('[data-act="createBudget"]');
  await tick(10);
  eq("새 예산으로 바뀐다", txt("homeBudgetName"), "생활비");

  click('[data-act="openSwitcher"]');
  await tick(4);
  const rows = doc.querySelectorAll('[data-el="switcherList"] [data-act="pickBudget"]');
  eq("예산 두 개가 목록에 나온다", rows.length, 2);
  const busanRow = [...rows].find((r) => r.textContent.includes("부산 여행"));
  click(busanRow);
  await tick(10);
  eq("한 번 눌러 예산이 바뀐다", txt("homeBudgetName"), "부산 여행");
  ok("고르면 시트가 닫힌다", !visible("switcherOpen"));
  eq("바뀐 예산의 금액이 보인다", txt("remainingText"), "370,000");

  // 내역 화면: 예산 칩 줄은 사라지고, 오늘이 카드로 강조된다
  click('[data-act="goHistory"]');
  await tick(6);
  ok("내역 상단에 예산 칩 줄이 없다", !doc.querySelector('[data-el="budgetChips"]'));
  ok("내역 상단에 예산 이름이 없다", !txt("viewPeriodText").includes("부산 여행"));
  eq("기간만 남는다", txt("viewPeriodText"), tripPeriod);
  const todayCard = doc.querySelector('[data-el="groups"] > div');
  ok("오늘이 첫 묶음이다", todayCard.textContent.includes("오늘"));
  ok("오늘 묶음은 테두리로 강조된다", todayCard.getAttribute("style").includes("border:1px solid var(--fg)"));
  ok("오늘 합계가 크게 보인다", todayCard.textContent.includes("30,000"));
  ok("오늘 몇 건인지 보인다", todayCard.textContent.includes("1건"));
  ok("내역 전체 삭제 버튼은 없앴다 (꾹 눌러 선택으로 대체)", !doc.querySelector('[data-act="deleteAllInHistory"]'));
  click('[data-act="goHome"]');
  await tick(4);

  // 설정에서 새로고침 / 캐시 비우기 / 내역 전체 삭제는 빠졌다
  click('[data-act="openMenu"]');
  await tick(3);
  ok("메뉴에 새로고침이 없다", !doc.querySelector('[data-act="menuRefresh"]'));
  ok("메뉴에 앱 새로 받기가 없다", !doc.querySelector('[data-act="hardReset"]'));
  ok("메뉴에 내역 전체 삭제가 없다", !doc.querySelector('[data-act="deleteAllFromMenu"]'));
  click('[data-act="closeMenu"]');
  await tick(3);

  // 나의 가계부: 아무것도 묻지 않고 바로 시작된다
  click('[data-act="openSwitcher"]');
  await tick(4);
  click('[data-el="switcherList"] [data-act="openPersonal"]');
  await tick(14);

  ok("설정을 묻지 않고 바로 시작한다", !visible("personalOpen"));
  ok("나의 가계부로 들어온다", visible("hasBudget"));
  eq("상단이 나의 가계부로 바뀐다", txt("homeBudgetName"), "나의 가계부");
  const personalPath = [...fake.docs.keys()].find(
    (k) => k.startsWith("budgets/") && k.split("/").length === 2 && fake.docs.get(k).kind === "personal"
  );
  ok("나의 가계부 문서가 생긴다", !!personalPath);
  eq("한도 없이 시작한다", fake.docs.get(personalPath).totalAmount, 0);
  eq("기본은 매달", fake.docs.get(personalPath).periodMode, "month");
  eq("이번 달로 시작한다", fake.docs.get(personalPath).startDate, win.MP.calc.monthBounds(win.MP.calc.todayISO()).start);

  eq("한도가 없으면 쓴 돈을 보여준다", txt("mainLabel"), "쓴 돈");
  ok("게이지는 숨긴다", !visible("hasLimit"));
  ok("한도를 정하라는 안내가 보인다", visible("noLimit"));
  eq("권장액 대신 하루 평균", txt("perDayLabel"), "하루 평균");
  eq("아직 쓴 게 없다", txt("remainingText"), "0");

  // 한도와 기간은 나의 가계부 안에서 정한다
  click('[data-show="isPersonalHome"][data-act="openPersonal"]');
  await tick(8);
  ok("설정 화면이 열린다", visible("personalOpen"));
  ok("기본 기간은 매달", !visible("pbCustom"));
  click('[data-act="pbModeCustom"]');
  await tick(3);
  ok("직접 지정을 고르면 날짜 칸이 열린다", visible("pbCustom"));
  click('[data-act="pbModeMonth"]');
  await tick(3);
  ok("매달로 되돌릴 수 있다", !visible("pbCustom"));
  type("pbTotal", "600000");
  await tick(3);
  click('[data-act="savePersonal"]');
  await tick(14);

  eq("한도가 저장된다", fake.docs.get(personalPath).totalAmount, 600000);
  ok("설정 화면이 닫힌다", !visible("personalOpen"));
  eq("한도가 생기면 남은 금액으로", txt("mainLabel"), "남은 금액");
  eq("남은 금액은 한도 그대로", txt("remainingText"), "600,000");
  eq("오늘 쓸 수 있는 돈으로 바뀐다", txt("perDayLabel"), "오늘 쓸 수 있는 돈");
  ok("게이지가 다시 보인다", visible("hasLimit"));

  // 나의 가계부는 함께 쓸 수 없다
  click('[data-act="openShare"]');
  await tick(4);
  click('[data-act="createInvite"]');
  await tick(8);
  ok("나의 가계부는 초대할 수 없다고 알려 준다", visible("shareError") && txt("shareErrorText").includes("혼자"), txt("shareErrorText"));
  click('[data-act="closeShare"]');
  await tick(3);

  // 다시 여행 예산으로 돌아온다
  click('[data-act="openSwitcher"]');
  await tick(4);
  ok("두 구역이 모두 보인다", el("switcherList").textContent.includes("나의 가계부") &&
     el("switcherList").textContent.includes("부산 여행"));
  const backRow = [...doc.querySelectorAll('[data-el="switcherList"] [data-act="pickBudget"]')]
    .find((r) => r.textContent.includes("부산 여행"));
  click(backRow);
  await tick(10);
  eq("여행 예산으로 돌아온다", txt("homeBudgetName"), "부산 여행");

  /* --- 6. 초대 코드 --- */
  click('[data-act="openShare"]');
  await tick(3);
  ok("함께 쓰기 화면이 열린다", visible("shareOpen"));
  ok("아직 코드가 없다", visible("shareNoCode"));

  click('[data-act="createInvite"]');
  await tick(12);

  ok("코드가 만들어져 보인다", visible("shareHasCode"));
  const code = txt("inviteCodeText");
  eq("코드는 8자리", code.length, 8);
  eq("invites 문서가 생긴다", !!fake.docs.get("invites/" + code), true);
  eq("invites 가 예산을 가리킨다", fake.docs.get("invites/" + code).budgetId, budgetPath.split("/")[1]);
  eq("예산에도 코드가 붙는다", fake.docs.get(budgetPath).inviteCode, code);
  ok("주인에게만 보이는 조작이 노출된다", visible("isInviteOwner"));

  click('[data-act="closeShare"]');
  await tick(2);

  /* --- 7. 다른 사람이 들어와서 쓴 것처럼 --- */
  const bId = budgetPath.split("/")[1];
  await fake.db.collection("budgets").doc(bId).update({
    memberUids: fake.firebase.firestore.FieldValue.arrayUnion("uid_9"),
    "members.uid_9": { name: "예은" }
  });
  await fake.db
    .collection("budgets")
    .doc(bId)
    .collection("expenses")
    .doc("e_other")
    .set({
      budgetId: bId,
      amount: 90000,
      categoryId: "cat_5",
      categoryName: "숙박",
      categoryEmoji: "🛏",
      memo: "게스트하우스",
      date: win.MP.calc.todayISO(),
      createdAt: 2,
      uid: "uid_9",
      userName: "예은"
    });
  await tick(12);

  eq("상대가 쓴 돈까지 합산된다", txt("remainingText"), "280,000");
  ok("함께 쓰는 예산 표시가 뜬다", visible("isSharedHome"));
  const avatars = el("memberAvatars");
  eq("함께 쓰는 사람이 동그라미 두 개로", avatars.children.length, 2);
  eq("첫 번째는 나", avatars.children[0].textContent, "나");
  eq("두 번째는 상대 이름 첫 글자", avatars.children[1].textContent, "예");
  ok("내 동그라미만 반전", avatars.children[0].getAttribute("style").includes("background:var(--fg)"));
  ok("상대 동그라미는 회색", avatars.children[1].getAttribute("style").includes("background:var(--g1)"));
  ok("겹쳐 놓되 배경색 링으로 떨어뜨린다",
    avatars.children[1].getAttribute("style").includes("margin-left:-0.375rem") &&
    avatars.children[1].getAttribute("style").includes("box-shadow:0 0 0 2px var(--bg)"));
  ok("이모지는 쓰지 않는다", !avatars.textContent.includes("👥"));
  eq("전체 이름은 설명으로 남긴다", el("memberButton").getAttribute("title"), "나 · 예은");
  ok("눌러서 멤버 관리로 갈 수 있다", el("memberButton").getAttribute("data-act") === "openShare");
  ok("오늘 내역에 상대 이름이 보인다", el("todayList").textContent.includes("예은"));

  /* --- 8. 요약: 사람별 + 정산 --- */
  click('[data-act="goSummary"]');
  await tick(6);
  ok("요약 탭이 열린다", visible("isSummary"));
  ok("사람별 영역이 보인다", visible("isSharedSummary"));
  eq("1인당 몫", txt("perPersonText"), "60,000");
  ok("정산 안내가 뜬다", visible("hasSettlement"));
  const settle = el("settlement").textContent;
  ok("덜 낸 사람이 더 낸 사람에게 보낸다", settle.includes("지민") && settle.includes("예은"), settle);
  ok("정산 금액이 표시된다", settle.includes("30,000"), settle);
  ok("사람별 목록에 두 사람이 다 나온다",
    el("memberShares").textContent.includes("지민") && el("memberShares").textContent.includes("예은"));

  // 도넛: 카테고리마다 다른 색
  const donut = el("donut").getAttribute("style");
  ok("도넛이 카테고리 색으로 나뉜다", donut.includes("var(--c1)"), donut);
  ok("두 번째 카테고리는 다른 색", donut.includes("var(--c2)"), donut);
  ok("조각 사이에 배경색 틈이 있다", donut.includes("var(--bg)"), donut);
  ok("남은 몫은 연한 회색", donut.includes("var(--g1)"), donut);
  const sharesHTML = el("shares").innerHTML;
  ok("목록에도 같은 색 점이 붙는다", sharesHTML.includes("var(--c1)") && sharesHTML.includes("var(--c2)"));
  ok("색만이 아니라 이름과 금액도 적혀 있다",
    el("shares").textContent.includes("숙박") && el("shares").textContent.includes("90,000"));
  ok("요약 줄에 비율 막대는 없다 (색점과 숫자로 읽는다)",
    !/width:\d+(\.\d+)?%/.test(el("shares").innerHTML), el("shares").innerHTML.slice(0, 200));
  ok("색점은 원형", el("shares").innerHTML.includes("width:0.4375rem;height:0.4375rem;border-radius:50%"));

  /* --- 9. 내역 탭 --- */
  click('[data-act="goHistory"]');
  await tick(6);
  ok("내역 탭이 열린다", visible("isHistory"));
  eq("합계", txt("viewSpentText"), "120,000");
  ok("작성자 이름이 줄마다 보인다", el("groups").textContent.includes("예은"));

  // 달력 보기
  ok("기본은 리스트", visible("listMode") && !visible("calMode"));
  click('[data-act="toggleCalendar"]');
  await tick(7);
  ok("달력으로 바뀐다", visible("calMode") && !visible("listMode"));
  ok("리스트는 감춰진다", !visible("hasRows"));
  ok("달 제목이 나온다", txt("calMonthText").includes("월"), txt("calMonthText"));

  const cells = [...doc.querySelectorAll('[data-el="calGrid"] .mm-cal-cell')];
  eq("항상 6주 42칸", cells.length, 42);
  const filled = cells.filter((c) => !c.disabled);
  ok("내역 있는 날만 누를 수 있다", filled.length > 0);
  ok("칸 안에 금액이 보인다", filled[0].textContent.includes(","), filled[0].textContent);
  ok("칸 안에 카테고리 이모지가 보인다", /\p{Extended_Pictographic}/u.test(filled[0].textContent));

  const monthBefore = txt("calMonthText");
  click('[data-act="calPrev"]');
  await tick(5);
  ok("이전 달로 넘어간다", txt("calMonthText") !== monthBefore);
  click('[data-act="calNext"]');
  await tick(5);
  eq("다시 돌아온다", txt("calMonthText"), monthBefore);

  // 날짜를 누르면 상세 팝업 (달을 넘겼다 왔으므로 칸을 다시 찾는다)
  const fresh = [...doc.querySelectorAll('[data-el="calGrid"] .mm-cal-cell')].filter((c) => !c.disabled);
  ok("달을 오가도 내역 있는 칸이 그대로다", fresh.length === filled.length);
  click(fresh.find((c) => c.getAttribute("data-date") === win.MP.calc.todayISO()) || fresh[0]);
  await tick(6);
  ok("날짜를 누르면 상세가 열린다", visible("dayOpen"));
  ok("그날 합계가 보인다", txt("daySum").includes("원"), txt("daySum"));
  ok("상세에 항목이 나온다", el("dayList").textContent.length > 0);
  ok("상세에서 삭제할 수 있다", !!doc.querySelector('[data-el="dayList"] [data-act="removeExpense"]'));

  const editFromDay = doc.querySelector('[data-el="dayList"] [data-act="editExpense"]');
  ok("상세에서 수정으로 갈 수 있다", !!editFromDay);
  click(editFromDay);
  await tick(7);
  ok("수정 화면이 열린다", visible("addOpen"));
  ok("팝업은 닫힌다", !visible("dayOpen"));
  click('[data-act="closeAdd"]');
  await tick(5);

  click('[data-act="toggleCalendar"]');
  await tick(6);
  ok("다시 리스트로 돌아온다", visible("listMode") && !visible("calMode"));

  /* --- 10. 테마 --- */
  click('[data-act="goHome"]');
  await tick(3);
  const before = doc.documentElement.dataset.mm;
  click('[data-act="openMenu"]');
  await tick(2);
  click('[data-act="toggleTheme"]');
  await tick(8);
  ok("테마가 바뀐다", doc.documentElement.dataset.mm !== before);
  eq("테마가 계정에 저장된다", fake.docs.get("users/uid_1").theme, doc.documentElement.dataset.mm);
  eq("상태바 색도 같이 바뀐다",
    doc.querySelector('meta[name="theme-color"]').getAttribute("content"),
    doc.documentElement.dataset.mm === "dark" ? "#0a0a0a" : "#ffffff");

  /* --- 11. 로그아웃 --- */
  click('[data-act="openMenu"]');
  await tick(2);
  click('[data-act="signOut"]');
  await tick(5);
  ok("로그아웃은 앱 확인창으로 묻는다", dialogOpen());
  eq("확인창 제목", txt("dialogTitle"), "로그아웃할까요?");
  eq("확인 버튼 문구도 상황에 맞게", txt("dialogOk"), "로그아웃");
  ok("취소 버튼이 있다", visible("dialogHasCancel"));
  ok("입력칸은 없다", !visible("dialogHasInput"));

  // 취소하면 아무 일도 없어야 한다
  click('[data-act="dialogCancel"]');
  await tick(6);
  ok("취소하면 확인창만 닫힌다", !dialogOpen() && !visible("authForm"));

  click('[data-act="signOut"]');
  await tick(5);
  await acceptDialog();
  await tick(10);
  ok("로그아웃하면 로그인 화면으로 돌아온다", visible("authForm"));
  ok("가계부 본문은 감춰진다", !visible("hasBudget"));

  /* --- 12. 다시 로그인하면 그대로 --- */
  type("authEmail", "a@test.com");
  type("authPassword", "secret1");
  click('[data-act="authSubmit"]');
  await tick(15);
  ok("다시 로그인하면 데이터가 그대로다", visible("hasBudget"));
  eq("금액도 그대로", txt("remainingText"), "280,000");

  /* --- 13. 두 번째 사용자가 초대 코드로 참여 --- */
  click('[data-act="openMenu"]');
  await tick(2);
  click('[data-act="signOut"]');
  await tick(5);
  await acceptDialog();
  await tick(8);
  click('[data-act="authModeSignup"]');
  await tick(2);
  type("authName", "하늘");
  type("authEmail", "b@test.com");
  type("authPassword", "secret2");
  click('[data-act="authSubmit"]');
  await tick(15);
  ok("새 사용자는 예산이 없다", visible("noBudget"));

  click('[data-act="openShare"]');
  await tick(3);
  type("joinCode", code.toLowerCase());
  await tick(2);
  ok("코드를 다 넣으면 참여 버튼이 켜진다", el("joinButton").disabled === false);
  click('[data-act="joinByCode"]');
  await tick(15);

  ok("참여하면 그 가계부가 열린다", visible("hasBudget"));
  eq("참여 후 멤버 3명", fake.docs.get(budgetPath).memberUids.length, 3);
  ok("참여자가 멤버 목록에 들어간다", fake.docs.get(budgetPath).memberUids.includes("uid_2"));
  eq("참여자 이름이 예산에 기록된다", fake.docs.get(budgetPath).members.uid_2.name, "하늘");
  eq("남은 금액이 같이 보인다", txt("remainingText"), "280,000");
  ok("상대가 쓴 내역이 보인다", el("todayList").textContent.includes("예은"));

  /* --- 14. 화면 크기 대응 --- */
  const css = fs.readFileSync(path.join(ROOT, "css/app.css"), "utf8");
  ok("루트 글자 크기로 배율을 잡는다", /html\s*\{[^}]*font-size:\s*clamp\(/.test(css), css.slice(0, 200));
  ok("기준 폭 390(=16px)으로 나눈다", css.includes("24.375"));
  ok("프레임 폭(430)을 넘어서는 커지지 않는다", css.includes("min(100vw, 430px)"));
  ok("낮은 화면에서는 높이도 본다", css.includes("100dvh / 44"));
  ok("min()을 모르는 브라우저용 기본값이 있다", /font-size:\s*16px;/.test(css));

  // 주석은 설명이라 px 이라고 적혀 있어도 상관없다
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hasRawPx = (text) =>
    (stripComments(text).match(/(?<![\w.-])(\d+(?:\.\d+)?)px/g) || []).filter((v) => {
      const n = parseFloat(v);
      return n >= 3 && n !== 430 && n !== 999 && n !== 9999;
    });
  eq("index.html 에 남은 고정 px 없음", hasRawPx(html).length, 0);
  eq("app.js 에 남은 고정 px 없음",
    hasRawPx(fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8")).length, 0);
  eq("app.css 에 남은 고정 px 없음",
    hasRawPx(css.replace(/font-size:[^;]+;/g, "")).length, 0);

  // 배율을 못 재는 환경(스타일시트 미적용)에서도 1로 떨어져야 한다
  ok("큰 금액에 px 글자 크기가 실제로 적용된다", /\d+px$/.test(el("remainingText").style.fontSize),
    el("remainingText").style.fontSize);

  /* --- 15. 앱 확인창 --- */
  click('[data-act="openMenu"]');
  await tick(3);
  click('[data-act="renameMe"]');
  await tick(4);
  ok("이름 바꾸기도 앱 확인창", dialogOpen());
  eq("제목", txt("dialogTitle"), "이름 바꾸기");
  ok("입력칸이 있다", visible("dialogHasInput"));
  eq("지금 이름이 미리 채워져 있다", el("dialogValue").value, "하늘");
  eq("이름 길이 제한", el("dialogValue").getAttribute("maxlength"), "20");

  el("dialogValue").value = "하늘이";
  await acceptDialog();
  ok("확인창이 닫힌다", !dialogOpen());
  eq("계정 이름이 바뀐다", fake.docs.get("users/uid_2").displayName, "하늘이");

  eq("브라우저 기본 창은 한 번도 쓰지 않는다", nativeCalls.length, 0, nativeCalls.join(" | "));

  const appJs = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("코드에도 confirm/alert/prompt 호출이 없다",
    !/(^|[^.\w])(confirm|alert|prompt)\s*\(/.test(appJs));

  /* --- 16. 좌우 스와이프로 탭 넘기기 --- */
  click('[data-act="goHome"]');
  await tick(5);
  eq("홈에서 시작", currentTab(), "home");

  await swipeRight();
  eq("홈에서 오른쪽으로 밀어도 그대로 (앞이 없다)", currentTab(), "home");

  await swipeLeft();
  eq("홈에서 왼쪽으로 밀면 내역", currentTab(), "history");
  ok("내역 화면이 실제로 보인다", visible("isHistory"));
  ok("오른쪽에서 들어온 표시", el("scroller").classList.contains("mm-in-right"));

  await swipeLeft();
  eq("내역에서 왼쪽으로 밀면 요약", currentTab(), "summary");
  ok("요약 화면이 실제로 보인다", visible("isSummary"));

  await swipeLeft();
  eq("요약에서 왼쪽으로 더 밀어도 그대로 (뒤가 없다)", currentTab(), "summary");

  await swipeRight();
  eq("요약에서 오른쪽으로 밀면 내역", currentTab(), "history");
  ok("왼쪽에서 들어온 표시", el("scroller").classList.contains("mm-in-left"));

  await swipeRight();
  eq("내역에서 오른쪽으로 밀면 홈", currentTab(), "home");

  // 너무 짧거나 세로에 가까우면 넘기지 않는다
  await drag(-30, 0);
  eq("살짝 민 것은 무시", currentTab(), "home");
  await drag(-90, 120);
  eq("세로에 가까우면 스크롤로 본다", currentTab(), "home");

  // 지출 줄에서 시작한 가로 스와이프는 그 줄의 것 (수정·삭제)
  await wait(200); // 스와이프 직후의 클릭 차단이 풀린 뒤에
  click('[data-act="goHistory"]');
  await tick(6);
  const row = doc.querySelector("[data-row]");
  ok("내역에 지출 줄이 있다", !!row);
  await swipeLeft(row);
  eq("줄에서 시작하면 탭은 그대로", currentTab(), "history");

  // 확인창이 떠 있으면 넘기지 않는다
  click('[data-act="goHome"]');
  await tick(5);
  click('[data-act="openMenu"]');
  await tick(3);
  click('[data-act="renameMe"]');
  await tick(4);
  ok("확인창이 떠 있다", dialogOpen());
  await swipeLeft();
  eq("확인창 위에서는 넘기지 않는다", currentTab(), "home");
  click('[data-act="dialogCancel"]');
  await tick(5);

  report();

  function report() {
    const failed = results.filter((r) => !r.ok);
    results.forEach((r) => {
      if (!r.ok) console.log("  FAIL  " + r.name + (r.extra ? "\n        " + r.extra : ""));
    });
    console.log("\n" + (results.length - failed.length) + " / " + results.length + " passed");
    process.exit(failed.length ? 1 : 0);
  }
})().catch((e) => {
  console.log("HARNESS ERROR: " + e.stack);
  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => {
    if (!r.ok) console.log("  FAIL  " + r.name + (r.extra ? "\n        " + r.extra : ""));
  });
  console.log("\n" + (results.length - failed.length) + " / " + results.length + " passed (중단됨)");
  process.exit(1);
});
