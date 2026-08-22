/* auth.js — Firebase 초기화 + 로그인/회원가입/로그아웃.
   앱의 나머지 부분은 firebase 전역을 직접 만지지 않고 여기만 통해서 쓴다. */
(function () {
  "use strict";

  var REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

  /* status:
       "loading"    설정을 확인하고 인증 상태를 기다리는 중
       "unconfigured"  firebase-config.js를 아직 안 채움
       "sdk-failed"    Firebase SDK를 못 받아옴 (첫 실행인데 오프라인 등)
       "signed-out"    로그인 필요
       "signed-in"     사용 가능 */
  var state = {
    status: "loading",
    user: null,      // { uid, name, email }
    detail: ""       // 화면에 덧붙일 설명
  };

  var listeners = [];
  var app = null;
  var auth = null;

  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }

  function setState(status, detail) {
    state.status = status;
    state.detail = detail || "";
    emit();
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== fn;
      });
    };
  }

  /* ---------- 설정 확인 ---------- */

  function configured() {
    var cfg = window.MP_FIREBASE_CONFIG;
    if (!cfg || typeof cfg !== "object") return false;
    for (var i = 0; i < REQUIRED_KEYS.length; i++) {
      var v = cfg[REQUIRED_KEYS[i]];
      if (typeof v !== "string" || !v || v.indexOf("PASTE_YOUR") === 0) return false;
    }
    return true;
  }

  /* ---------- 사용자 표시 이름 ---------- */

  /** displayName이 비어 있으면 이메일 아이디 부분을 쓴다 */
  function nameOf(user) {
    if (!user) return "";
    var n = (user.displayName || "").trim();
    if (n) return n;
    var mail = (user.email || "").trim();
    var at = mail.indexOf("@");
    return at > 0 ? mail.slice(0, at) : "사용자";
  }

  function toPublic(user) {
    if (!user) return null;
    return { uid: user.uid, name: nameOf(user), email: (user.email || "").trim() };
  }

  /* ---------- 초기화 ---------- */

  function init() {
    if (!configured()) {
      setState("unconfigured");
      return;
    }
    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      setState("sdk-failed", "Firebase 스크립트를 불러오지 못했습니다.");
      return;
    }

    try {
      app = firebase.apps && firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.MP_FIREBASE_CONFIG);
      auth = firebase.auth();
    } catch (e) {
      setState("sdk-failed", messageOf(e));
      return;
    }

    // 로그인 상태를 기기에 남긴다 -> 다음에 열 때, 그리고 오프라인에서도 바로 들어간다
    var persisted = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {
      /* 사파리 프라이빗 모드 등에서 저장이 막히면 이번 세션에만 로그인 상태를 유지한다 */
    });

    persisted.then(function () {
      auth.onAuthStateChanged(
        function (user) {
          state.user = toPublic(user);
          setState(user ? "signed-in" : "signed-out");
        },
        function (err) {
          setState("signed-out", messageOf(err));
        }
      );
    });
  }

  /* ---------- 동작 ---------- */

  function signUp(email, password, name) {
    if (!auth) return Promise.reject(new Error("준비되지 않았습니다."));
    var clean = (name || "").trim().slice(0, 20);
    return auth
      .createUserWithEmailAndPassword((email || "").trim(), password || "")
      .then(function (cred) {
        if (!clean || !cred.user) return cred;
        // 이름은 실패해도 가입 자체는 살린다 (다음 로그인 때 이메일 아이디로 대체됨)
        return cred.user.updateProfile({ displayName: clean }).then(
          function () {
            state.user = toPublic(auth.currentUser);
            emit();
            return cred;
          },
          function () {
            return cred;
          }
        );
      });
  }

  function signIn(email, password) {
    if (!auth) return Promise.reject(new Error("준비되지 않았습니다."));
    return auth.signInWithEmailAndPassword((email || "").trim(), password || "");
  }

  function signOut() {
    if (!auth) return Promise.resolve();
    return auth.signOut();
  }

  function resetPassword(email) {
    if (!auth) return Promise.reject(new Error("준비되지 않았습니다."));
    return auth.sendPasswordResetEmail((email || "").trim());
  }

  /** 표시 이름 변경 (공유 예산에서 다른 사람에게 보이는 이름) */
  function rename(name) {
    if (!auth || !auth.currentUser) return Promise.reject(new Error("로그인이 필요합니다."));
    var clean = (name || "").trim().slice(0, 20);
    if (!clean) return Promise.reject(new Error("이름을 입력해 주세요."));
    return auth.currentUser.updateProfile({ displayName: clean }).then(function () {
      state.user = toPublic(auth.currentUser);
      emit();
      return state.user;
    });
  }

  /* ---------- 오류 메시지 ---------- */

  var MESSAGES = {
    "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
    "auth/missing-email": "이메일을 입력해 주세요.",
    "auth/user-disabled": "사용이 중지된 계정입니다.",
    "auth/user-not-found": "이메일 또는 비밀번호가 맞지 않습니다.",
    "auth/wrong-password": "이메일 또는 비밀번호가 맞지 않습니다.",
    "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않습니다.",
    "auth/invalid-login-credentials": "이메일 또는 비밀번호가 맞지 않습니다.",
    "auth/email-already-in-use": "이미 가입된 이메일입니다. 로그인해 주세요.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/missing-password": "비밀번호를 입력해 주세요.",
    "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 해 주세요.",
    "auth/network-request-failed": "네트워크에 연결할 수 없습니다.",
    "auth/operation-not-allowed":
      "이메일 로그인이 꺼져 있습니다. Firebase 콘솔 → Authentication에서 켜 주세요.",
    "auth/unauthorized-domain":
      "이 주소가 Firebase에 등록되어 있지 않습니다. Authentication → Settings → 승인된 도메인에 추가해 주세요.",
    "permission-denied": "권한이 없습니다. 보안 규칙(firestore.rules)을 배포했는지 확인해 주세요.",
    unavailable: "서버에 연결할 수 없습니다. 연결되면 자동으로 다시 보냅니다.",
    "failed-precondition": "데이터베이스 준비가 필요합니다. README의 Firestore 설정을 확인해 주세요."
  };

  function messageOf(err) {
    if (!err) return "알 수 없는 오류가 발생했습니다.";
    var code = err.code || "";
    if (MESSAGES[code]) return MESSAGES[code];
    return err.message ? String(err.message).replace(/^Firebase:\s*/, "") : "오류가 발생했습니다.";
  }

  window.MP = window.MP || {};
  window.MP.auth = {
    init: init,
    configured: configured,
    subscribe: subscribe,
    state: function () {
      return state;
    },
    user: function () {
      return state.user;
    },
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    rename: rename,
    messageOf: messageOf
  };
})();
