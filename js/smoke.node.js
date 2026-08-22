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

  const auth = {
    get currentUser() {
      return current;
    },
    setPersistence: () => Promise.resolve(),
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
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: "local" } } }),
    firestore: Object.assign(() => db, { FieldValue })
  };

  return { firebase, docs, db, authApi: auth, snapOf, childrenOf };
}

/* ================= 구동 ================= */

async function tick(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
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

  win.confirm = () => true;
  win.alert = () => {};
  win.prompt = () => "새이름";

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

  await tick();

  /* --- 1. 로그인 화면 --- */
  ok("처음엔 로그인 화면이 뜬다", visible("authForm"));
  ok("설정 안내는 안 뜬다 (설정이 채워져 있으므로)", !visible("authSetup"));
  ok("가계부 본문은 아직 안 보인다", !visible("hasBudget") && !visible("noBudget"));

  /* --- 2. 회원가입 --- */
  click('[data-act="authModeSignup"]');
  await tick(2);
  ok("회원가입 탭에서 이름 칸이 보인다", visible("isSignup"));

  type("authName", "지민");
  type("authEmail", "a@test.com");
  type("authPassword", "secret1");
  ok("입력이 다 차면 버튼이 켜진다", el("authSubmit").disabled === false);

  click('[data-act="authSubmit"]');
  await tick(12);

  ok("가입 후 로그인 화면이 사라진다", !visible("authForm"));
  ok("예산이 없으니 시작 화면이 뜬다", visible("noBudget"), "authLoading=" + visible("authLoading"));
  eq("사용자 문서가 만들어진다", !!fake.docs.get("users/uid_1"), true);
  eq("기본 카테고리 14개가 계정에 저장된다", fake.docs.get("users/uid_1").categories.length, 14);
  eq("표시 이름이 저장된다", fake.docs.get("users/uid_1").displayName, "지민");

  /* --- 3. 예산 만들기 --- */
  click('[data-act="openBudget"]');
  await tick(2);
  ok("예산 시트가 열린다", visible("budgetOpen"));

  type("nbName", "부산 여행");
  type("nbStart", "2026-08-20");
  type("nbEnd", "2026-08-23");
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
      date: new win.Date().toISOString().slice(0, 10),
      createdAt: 2,
      uid: "uid_9",
      userName: "예은"
    });
  await tick(12);

  eq("상대가 쓴 돈까지 합산된다", txt("remainingText"), "280,000");
  ok("함께 쓰는 예산 표시가 뜬다", visible("isSharedHome"));
  eq("멤버 수 배지", txt("sharedBadge"), "👥 2명");
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

  /* --- 9. 내역 탭 --- */
  click('[data-act="goHistory"]');
  await tick(6);
  ok("내역 탭이 열린다", visible("isHistory"));
  eq("합계", txt("viewSpentText"), "120,000");
  ok("작성자 이름이 줄마다 보인다", el("groups").textContent.includes("예은"));

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
  await tick(12);
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
  await tick(10);
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
