/* store.js — Firestore 데이터 레이어.
   - 화면이 쓰는 모양(data.budgets / data.expenses / data.categories / data.settings)은 예전과 같다.
   - 읽기는 실시간 구독. 오프라인 캐시가 켜져 있어서 인터넷이 끊겨도 마지막 내용이 보인다.
   - 쓰기는 그냥 던진다. 오프라인이면 Firestore가 큐에 넣었다가 연결되면 자동으로 보낸다.

   문서 구조
     users/{uid}                        categories, activeBudgetId, theme
     budgets/{budgetId}                 이름/기간/총액 + ownerUid, memberUids, members, inviteCode
     budgets/{budgetId}/expenses/{id}   지출 (누가 썼는지 uid/userName 포함)
     invites/{code}                     초대 코드 -> budgetId */
(function () {
  "use strict";

  var calc = MP.calc;
  var model = MP.model;

  var THEME_KEY = "moneyplan.theme";        // 로그인 전에도 화면을 제 색으로 칠하려고 남기는 값
  var MIGRATED_KEY = "moneyplan.migrated";  // 옛 로컬 데이터를 계정으로 올렸는지 표시
  var BATCH_LIMIT = 400;                    // Firestore 배치 상한(500)보다 넉넉히 아래로

  var db = null;
  var me = null;                 // { uid, name, email }
  var data = emptyData();
  var listeners = [];
  var errorListeners = [];

  var unsubUser = null;
  var unsubBudgets = null;
  var expenseUnsubs = {};        // budgetId -> unsubscribe
  var rawBudgets = [];
  var rawExpenses = {};          // budgetId -> [expense]
  var rawUserDoc = null;
  var loaded = { user: false, budgets: false };
  var emitQueued = false;

  /* ---------- 로컬에 남기는 최소한의 값 ---------- */

  function lsGet(key) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch (e) {
      return null; // 사파리 프라이빗 모드 등
    }
  }

  function lsSet(key, value) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch (e) {
      /* 저장 못 해도 앱은 그대로 돌아간다 */
    }
  }

  /** 로그인 응답이 오기 전에도 테마를 맞춰 칠하기 위한 값 */
  function bootTheme() {
    return lsGet(THEME_KEY) === "dark" ? "dark" : "light";
  }

  /* ---------- 상태 ---------- */

  function emptyData() {
    var d = model.initialData();
    d.settings.theme = bootTheme();
    d.me = null;
    d.ready = false;
    return d;
  }

  function get() {
    return data;
  }

  function ready() {
    return loaded.user && loaded.budgets;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  function onError(fn) {
    errorListeners.push(fn);
    return function () {
      errorListeners = errorListeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  function fail(err, what) {
    var message = MP.auth ? MP.auth.messageOf(err) : String(err && err.message ? err.message : err);
    for (var i = 0; i < errorListeners.length; i++) errorListeners[i](message, what, err);
  }

  /** 한 번의 변경으로 여러 구독이 동시에 울려도 렌더는 한 번만 한다 */
  function scheduleEmit() {
    if (emitQueued) return;
    emitQueued = true;
    Promise.resolve().then(function () {
      emitQueued = false;
      rebuild();
      for (var i = 0; i < listeners.length; i++) listeners[i](data);
    });
  }

  /** 흩어져 있는 스냅샷들을 화면이 쓰는 한 덩어리로 합친다 */
  function rebuild() {
    var budgets = rawBudgets.slice().sort(function (a, b) {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt; // 최근에 만든 것부터
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    var expenses = [];
    budgets.forEach(function (b) {
      var list = rawExpenses[b.id];
      if (list) expenses = expenses.concat(list);
    });

    var u = rawUserDoc || {};
    // 사용자 문서가 아직 안 왔으면 이 기기에 남아 있던 테마를 그대로 쓴다.
    // (그러지 않으면 다크 모드로 열었다가 잠깐 흰 화면으로 번쩍인다)
    var theme = u.theme === "dark" || u.theme === "light" ? u.theme : bootTheme();

    var next = model.sanitize({
      budgets: budgets,
      expenses: expenses,
      categories: Array.isArray(u.categories) && u.categories.length ? u.categories : null,
      settings: {
        activeBudgetId: u.activeBudgetId || null,
        theme: theme
      }
    });

    next.me = me;
    next.ready = ready();
    data = next;
    lsSet(THEME_KEY, next.settings.theme);
  }

  /* ---------- Firestore 준비 ---------- */

  function initDb() {
    if (db) return db;
    db = firebase.firestore();
    // 오프라인 캐시. 다른 탭이 이미 켰거나 브라우저가 지원하지 않으면 조용히 넘어간다.
    try {
      db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
    } catch (e) {
      /* 이미 다른 곳에서 Firestore를 썼다면 여기서 던진다. 캐시 없이 계속 쓴다. */
    }
    return db;
  }

  function users() {
    return db.collection("users");
  }
  function budgetsCol() {
    return db.collection("budgets");
  }
  function invites() {
    return db.collection("invites");
  }
  function expensesCol(budgetId) {
    return budgetsCol().doc(budgetId).collection("expenses");
  }
  function fv() {
    return firebase.firestore.FieldValue;
  }

  function docData(snap) {
    var v = snap.data() || {};
    v.id = snap.id;
    return v;
  }

  /* ---------- 시작 / 정지 ---------- */

  function start(user) {
    stop();
    me = { uid: user.uid, name: user.name, email: user.email };
    initDb();
    loaded = { user: false, budgets: false };

    ensureUserDoc();
    watchUser();
    watchBudgets();
    scheduleEmit();
  }

  function stop() {
    if (unsubUser) unsubUser();
    if (unsubBudgets) unsubBudgets();
    Object.keys(expenseUnsubs).forEach(function (id) {
      expenseUnsubs[id]();
    });
    unsubUser = null;
    unsubBudgets = null;
    expenseUnsubs = {};
    rawBudgets = [];
    rawExpenses = {};
    rawUserDoc = null;
    loaded = { user: false, budgets: false };
    me = null;
    data = emptyData();
  }

  /** 처음 로그인한 사람에게 기본 카테고리를 깔아 준다 */
  function ensureUserDoc() {
    var ref = users().doc(me.uid);
    ref.get().then(
      function (snap) {
        if (snap.exists) {
          // 이름이 바뀌었으면 맞춰 둔다 (공유 예산에서 남에게 보이는 이름)
          if ((snap.data() || {}).displayName !== me.name) {
            ref.update({ displayName: me.name }).catch(function () {});
          }
          return;
        }
        return ref.set({
          displayName: me.name,
          email: me.email,
          createdAt: Date.now(),
          theme: bootTheme(),
          activeBudgetId: null,
          categories: model.defaultCategories()
        });
      },
      function () {
        /* 오프라인이라 확인할 수 없으면 아무것도 하지 않는다.
           온라인이 되면 구독이 실제 문서를 가져온다. */
      }
    ).catch(function (err) {
      fail(err, "user-init");
    });
  }

  function watchUser() {
    unsubUser = users().doc(me.uid).onSnapshot(
      function (snap) {
        rawUserDoc = snap.exists ? snap.data() : null;
        loaded.user = true;
        scheduleEmit();
      },
      function (err) {
        loaded.user = true; // 못 읽어도 화면은 열어 준다
        scheduleEmit();
        fail(err, "user");
      }
    );
  }

  function watchBudgets() {
    unsubBudgets = budgetsCol()
      .where("memberUids", "array-contains", me.uid)
      .onSnapshot(
        function (snap) {
          rawBudgets = snap.docs.map(docData);
          syncExpenseWatchers();
          loaded.budgets = true;
          scheduleEmit();
        },
        function (err) {
          loaded.budgets = true;
          scheduleEmit();
          fail(err, "budgets");
        }
      );
  }

  /** 예산이 생기고 없어질 때마다 지출 구독을 맞춰 붙였다 뗀다 */
  function syncExpenseWatchers() {
    var alive = {};
    rawBudgets.forEach(function (b) {
      alive[b.id] = true;
      if (expenseUnsubs[b.id]) return;
      expenseUnsubs[b.id] = expensesCol(b.id).onSnapshot(
        function (snap) {
          rawExpenses[b.id] = snap.docs.map(docData);
          scheduleEmit();
        },
        function (err) {
          rawExpenses[b.id] = rawExpenses[b.id] || [];
          scheduleEmit();
          fail(err, "expenses");
        }
      );
    });

    Object.keys(expenseUnsubs).forEach(function (id) {
      if (alive[id]) return;
      expenseUnsubs[id]();
      delete expenseUnsubs[id];
      delete rawExpenses[id];
    });
  }

  /* ---------- 조회 헬퍼 ---------- */

  function findBudget(id) {
    for (var i = 0; i < data.budgets.length; i++) {
      if (data.budgets[i].id === id) return data.budgets[i];
    }
    return null;
  }

  function myName() {
    return (me && me.name) || "나";
  }

  /**
   * 지출에 카테고리 이름/이모지를 함께 박아 둔다.
   * 같이 쓰는 사람의 카테고리 목록은 나와 다를 수 있어서,
   * 이름을 안 남기면 상대 화면에서 '카테고리 없음'으로 보인다.
   */
  function withCategorySnapshot(e) {
    var c = calc.findCategory(data.categories, e.categoryId);
    var out = {
      budgetId: e.budgetId,
      amount: e.amount,
      categoryId: e.categoryId || null,
      memo: e.memo || "",
      date: e.date,
      createdAt: e.createdAt || Date.now(),
      uid: (me && me.uid) || null,
      userName: myName(),
      categoryName: c ? c.name : e.categoryName || "",
      categoryEmoji: c ? c.emoji : e.categoryEmoji || "✏️"
    };
    return out;
  }

  /* ---------- 지출 ---------- */

  function addExpense(e) {
    var id = model.uid();
    var payload = withCategorySnapshot(e);
    expensesCol(e.budgetId).doc(id).set(payload).catch(function (err) {
      fail(err, "add-expense");
    });
    return id;
  }

  /** 되돌리기용: 지웠던 지출을 원래 id 그대로 되살린다 */
  function restoreExpenses(list) {
    chunked(list, function (batch, item) {
      var payload = {
        budgetId: item.budgetId,
        amount: item.amount,
        categoryId: item.categoryId || null,
        memo: item.memo || "",
        date: item.date,
        createdAt: item.createdAt || Date.now(),
        uid: item.uid || null,
        userName: item.userName || myName(),
        categoryName: item.categoryName || "",
        categoryEmoji: item.categoryEmoji || "✏️"
      };
      batch.set(expensesCol(item.budgetId).doc(item.id), payload);
    }, "restore-expense");
  }

  function patchExpense(id, patch) {
    var current = null;
    for (var i = 0; i < data.expenses.length; i++) {
      if (data.expenses[i].id === id) current = data.expenses[i];
    }
    if (!current) return;

    var next = {
      budgetId: patch.budgetId || current.budgetId,
      amount: patch.amount,
      categoryId: patch.categoryId,
      memo: patch.memo,
      date: patch.date
    };
    var payload = withCategorySnapshot(next);
    payload.createdAt = current.createdAt;
    payload.uid = current.uid || (me && me.uid) || null;
    payload.userName = current.userName || myName();

    expensesCol(current.budgetId).doc(id).set(payload).catch(function (err) {
      fail(err, "edit-expense");
    });
  }

  function removeExpenses(list) {
    chunked(list, function (batch, item) {
      batch.delete(expensesCol(item.budgetId).doc(item.id));
    }, "remove-expense");
  }

  /** 500건 제한에 걸리지 않게 나눠서 커밋한다 */
  function chunked(list, addTo, what) {
    for (var i = 0; i < list.length; i += BATCH_LIMIT) {
      var slice = list.slice(i, i + BATCH_LIMIT);
      var batch = db.batch();
      slice.forEach(function (item) {
        addTo(batch, item);
      });
      batch.commit().catch(function (err) {
        fail(err, what);
      });
    }
  }

  /* ---------- 예산 ---------- */

  function addBudget(b) {
    var ref = budgetsCol().doc();
    var members = {};
    members[me.uid] = { name: myName() };
    ref.set({
      name: b.name,
      startDate: b.startDate,
      endDate: b.endDate,
      totalAmount: b.totalAmount,
      createdAt: Date.now(),
      ownerUid: me.uid,
      memberUids: [me.uid],
      members: members,
      inviteCode: null
    }).catch(function (err) {
      fail(err, "add-budget");
    });
    setActiveBudget(ref.id);
    return ref.id;
  }

  function patchBudget(id, patch) {
    budgetsCol().doc(id).update(patch).catch(function (err) {
      fail(err, "edit-budget");
    });
  }

  /** 예산과 그 안의 지출, 초대 코드까지 지운다 (만든 사람만) */
  function removeBudget(id) {
    var b = findBudget(id);
    if (!b) return Promise.resolve();

    var mine = (rawExpenses[id] || []).map(function (e) {
      return e.id;
    });

    return expensesCol(id)
      .get()
      .then(
        function (snap) {
          return snap.docs.map(function (d) {
            return d.id;
          });
        },
        function () {
          return mine; // 오프라인이면 캐시에 있는 것만이라도 지운다
        }
      )
      .then(function (ids) {
        for (var i = 0; i < ids.length; i += BATCH_LIMIT) {
          var batch = db.batch();
          ids.slice(i, i + BATCH_LIMIT).forEach(function (eid) {
            batch.delete(expensesCol(id).doc(eid));
          });
          batch.commit().catch(function (err) {
            fail(err, "remove-budget-expenses");
          });
        }
        if (b.inviteCode) invites().doc(b.inviteCode).delete().catch(function () {});
        return budgetsCol().doc(id).delete();
      })
      .catch(function (err) {
        fail(err, "remove-budget");
      });
  }

  /* ---------- 함께 쓰기 ---------- */

  /** 초대 코드를 만들어 붙인다. 이미 있으면 새 코드로 갈아 끼운다. */
  function shareBudget(id) {
    var b = findBudget(id);
    if (!b) return Promise.reject(new Error("예산을 찾을 수 없습니다."));
    if (b.ownerUid !== me.uid) return Promise.reject(new Error("예산을 만든 사람만 초대할 수 있습니다."));

    var previous = b.inviteCode;

    function attempt(tries) {
      var code = model.newInviteCode();
      return invites()
        .doc(code)
        .get()
        .then(function (snap) {
          // 아주 낮은 확률의 충돌. 몇 번 다시 뽑아 본다.
          if (snap.exists && tries > 0) return attempt(tries - 1);
          if (snap.exists) throw new Error("초대 코드를 만들지 못했습니다. 다시 시도해 주세요.");
          return invites()
            .doc(code)
            .set({ budgetId: id, ownerUid: me.uid, createdAt: Date.now() })
            .then(function () {
              return budgetsCol().doc(id).update({ inviteCode: code });
            })
            .then(function () {
              if (previous && previous !== code) {
                return invites().doc(previous).delete().catch(function () {});
              }
            })
            .then(function () {
              return code;
            });
        });
    }

    return attempt(3);
  }

  /** 초대 코드를 없앤다. 이미 들어와 있는 사람은 그대로 남는다. */
  function stopInvites(id) {
    var b = findBudget(id);
    if (!b) return Promise.resolve();
    if (b.ownerUid !== me.uid) return Promise.reject(new Error("예산을 만든 사람만 바꿀 수 있습니다."));
    return budgetsCol()
      .doc(id)
      .update({ inviteCode: null })
      .then(function () {
        if (b.inviteCode) return invites().doc(b.inviteCode).delete().catch(function () {});
      })
      .catch(function (err) {
        fail(err, "stop-invites");
        throw err;
      });
  }

  /** 초대 코드로 남의 여행 가계부에 들어간다 */
  function joinByCode(input) {
    var code = model.normalizeInviteCode(input);
    if (!model.isInviteCode(code)) {
      return Promise.reject(new Error("초대 코드는 " + model.INVITE_LENGTH + "자리입니다."));
    }

    return invites()
      .doc(code)
      .get()
      .then(function (snap) {
        if (!snap.exists) throw new Error("그런 초대 코드가 없습니다. 다시 확인해 주세요.");
        var budgetId = (snap.data() || {}).budgetId;
        if (!budgetId) throw new Error("초대 코드가 잘못되었습니다.");

        // 이미 들어와 있으면 쓰지 않고 그 예산으로 넘어가기만 한다
        var already = findBudget(budgetId);
        if (already) {
          setActiveBudget(budgetId);
          return { budgetId: budgetId, alreadyMember: true, name: already.name };
        }

        var patch = { memberUids: fv().arrayUnion(me.uid) };
        patch["members." + me.uid] = { name: myName() };
        return budgetsCol()
          .doc(budgetId)
          .update(patch)
          .then(function () {
            setActiveBudget(budgetId);
            return { budgetId: budgetId, alreadyMember: false, name: "" };
          });
      });
  }

  /** 공유 예산에서 나간다. 내가 쓴 내역은 남는다. */
  function leaveBudget(id) {
    var b = findBudget(id);
    if (!b) return Promise.resolve();
    if (b.ownerUid === me.uid) {
      return Promise.reject(new Error("예산을 만든 사람은 나갈 수 없습니다. 예산을 삭제해 주세요."));
    }
    var patch = { memberUids: fv().arrayRemove(me.uid) };
    patch["members." + me.uid] = fv().delete();
    return budgetsCol()
      .doc(id)
      .update(patch)
      .catch(function (err) {
        fail(err, "leave-budget");
        throw err;
      });
  }

  /** 만든 사람이 멤버를 내보낸다 */
  function removeMember(id, uid) {
    var b = findBudget(id);
    if (!b) return Promise.resolve();
    if (b.ownerUid !== me.uid) return Promise.reject(new Error("예산을 만든 사람만 내보낼 수 있습니다."));
    if (uid === me.uid) return Promise.reject(new Error("자기 자신은 내보낼 수 없습니다."));
    var patch = { memberUids: fv().arrayRemove(uid) };
    patch["members." + uid] = fv().delete();
    return budgetsCol()
      .doc(id)
      .update(patch)
      .catch(function (err) {
        fail(err, "remove-member");
        throw err;
      });
  }

  /**
   * 이름을 바꿨을 때, 함께 쓰는 예산에 적힌 내 이름도 같이 고친다.
   * (지난 지출에 박힌 userName은 그때 그 이름 그대로 둔다 — 기록이므로)
   */
  function syncMyName(name) {
    if (!me || !db) return;
    me.name = name;
    users().doc(me.uid).set({ displayName: name }, { merge: true }).catch(function () {});
    data.budgets.forEach(function (b) {
      if (b.memberUids.indexOf(me.uid) < 0) return;
      if (b.members[me.uid] && b.members[me.uid].name === name) return;
      var patch = {};
      patch["members." + me.uid] = { name: name };
      budgetsCol().doc(b.id).update(patch).catch(function () {});
    });
  }

  /* ---------- 설정 / 카테고리 ---------- */

  function setActiveBudget(id) {
    users().doc(me.uid).update({ activeBudgetId: id || null }).catch(function (err) {
      // 문서가 아직 없을 수 있다 (첫 실행 + 오프라인)
      users().doc(me.uid).set({ activeBudgetId: id || null }, { merge: true }).catch(function () {
        fail(err, "active-budget");
      });
    });
  }

  function setTheme(theme) {
    var next = theme === "dark" ? "dark" : "light";
    lsSet(THEME_KEY, next); // 다음 실행 때 첫 화면부터 제 색으로
    if (!me || !db) return; // 로그인 전에는 이 기기에만 남긴다
    users().doc(me.uid).update({ theme: next }).catch(function () {
      users().doc(me.uid).set({ theme: next }, { merge: true }).catch(function (err) {
        fail(err, "theme");
      });
    });
  }

  function writeCategories(list) {
    var clean = model.normalizeCategories(list);
    users().doc(me.uid).update({ categories: clean }).catch(function () {
      users().doc(me.uid).set({ categories: clean }, { merge: true }).catch(function (err) {
        fail(err, "categories");
      });
    });
  }

  function addCategory(c) {
    var list = model.clone(data.categories);
    list.push({
      id: model.uid(),
      name: c.name,
      emoji: c.emoji,
      order: list.length,
      isDefault: false
    });
    writeCategories(list);
  }

  function patchCategory(id, patch) {
    var list = model.clone(data.categories);
    list.forEach(function (c) {
      if (c.id !== id) return;
      if (patch.name !== undefined) c.name = patch.name;
      if (patch.emoji !== undefined) c.emoji = patch.emoji;
    });
    writeCategories(list);
  }

  function moveCategory(id, dir) {
    var list = model.clone(data.categories);
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) i = k;
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    list.forEach(function (c, n) {
      c.order = n;
    });
    writeCategories(list);
  }

  /**
   * 카테고리 삭제. 그 카테고리로 적은 지출에는 이름/이모지를 남겨 둔다.
   * 이미 모든 지출에 스냅샷을 박아 두므로 서버 쪽 지출은 손댈 필요가 없다.
   */
  function removeCategory(id) {
    var list = data.categories.filter(function (c) {
      return c.id !== id;
    });
    writeCategories(list);
  }

  /* ---------- 옛 로컬 데이터 올리기 ---------- */

  /** 로그인 전에 이 기기에서 쓰던 내역이 남아 있는지 */
  function legacy() {
    var text = lsGet(model.LEGACY_KEY);
    if (!text) return null;
    if (lsGet(MIGRATED_KEY)) return null; // 이미 올렸다
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return null;
    }
    var d = model.migrate(parsed);
    if (!d.budgets.length) return null;
    return d;
  }

  /** 옛 데이터를 지금 계정으로 올린다. 로컬 원본은 지우지 않는다. */
  function importLegacy() {
    var d = legacy();
    if (!d) return Promise.resolve(0);

    var batch = db.batch();
    var idMap = {};
    var members = {};
    members[me.uid] = { name: myName() };

    d.budgets.forEach(function (b) {
      var ref = budgetsCol().doc();
      idMap[b.id] = ref.id;
      batch.set(ref, {
        name: b.name,
        startDate: b.startDate,
        endDate: b.endDate,
        totalAmount: b.totalAmount,
        createdAt: b.createdAt || Date.now(),
        ownerUid: me.uid,
        memberUids: [me.uid],
        members: members,
        inviteCode: null
      });
    });

    var written = 0;
    d.expenses.forEach(function (e) {
      var budgetId = idMap[e.budgetId];
      if (!budgetId) return;
      var c = calc.resolveCategory(e, d.categories);
      batch.set(expensesCol(budgetId).doc(model.uid()), {
        budgetId: budgetId,
        amount: e.amount,
        categoryId: e.categoryId || null,
        memo: e.memo || "",
        date: e.date,
        createdAt: e.createdAt || Date.now(),
        uid: me.uid,
        userName: myName(),
        categoryName: c.name,
        categoryEmoji: c.emoji
      });
      written++;
    });

    batch.set(
      users().doc(me.uid),
      {
        categories: d.categories,
        activeBudgetId: idMap[d.settings.activeBudgetId] || null,
        theme: d.settings.theme
      },
      { merge: true }
    );

    return batch.commit().then(function () {
      lsSet(MIGRATED_KEY, me.uid);
      return written;
    });
  }

  function skipLegacy() {
    lsSet(MIGRATED_KEY, "skipped");
  }

  /* ---------- 새로고침 ---------- */

  /**
   * 당겨서 새로고침. 실시간 구독이라 평소엔 이미 최신이지만,
   * 밀린 쓰기를 끝내고 서버에서 한 번 확실히 읽어 온다.
   * 오프라인이면 캐시 값으로 조용히 끝낸다 (오류로 취급하지 않는다).
   */
  function refresh() {
    if (!db || !me) return Promise.resolve(null);
    // SDK 버전에 따라 없을 수도 있다. 없으면 그냥 건너뛴다.
    var pending =
      typeof db.waitForPendingWrites === "function"
        ? db.waitForPendingWrites().catch(function () {})
        : Promise.resolve();

    return pending
      .then(function () {
        return budgetsCol()
          .where("memberUids", "array-contains", me.uid)
          .get({ source: "server" });
      })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false; // 오프라인 등. 화면은 캐시 값 그대로 둔다.
      });
  }

  window.MP = window.MP || {};
  window.MP.store = {
    // 상태
    get: get,
    ready: ready,
    bootTheme: bootTheme,
    subscribe: subscribe,
    onError: onError,
    // 수명주기
    start: start,
    stop: stop,
    refresh: refresh,
    // 지출
    addExpense: addExpense,
    patchExpense: patchExpense,
    removeExpenses: removeExpenses,
    restoreExpenses: restoreExpenses,
    // 예산
    addBudget: addBudget,
    patchBudget: patchBudget,
    removeBudget: removeBudget,
    setActiveBudget: setActiveBudget,
    // 함께 쓰기
    shareBudget: shareBudget,
    stopInvites: stopInvites,
    joinByCode: joinByCode,
    leaveBudget: leaveBudget,
    removeMember: removeMember,
    syncMyName: syncMyName,
    // 설정 / 카테고리
    setTheme: setTheme,
    addCategory: addCategory,
    patchCategory: patchCategory,
    moveCategory: moveCategory,
    removeCategory: removeCategory,
    // 옛 데이터
    legacy: legacy,
    importLegacy: importLegacy,
    skipLegacy: skipLegacy
  };
})();
