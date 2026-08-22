/* firebase-config.js — 여기에 본인 Firebase 프로젝트 설정을 붙여넣는다.

   받는 곳: Firebase 콘솔 → 프로젝트 설정(⚙) → 내 앱 → 웹 앱 → SDK 설정 및 구성 → "구성"
   자세한 절차는 README.md 참고.

   이 값들은 비밀번호가 아니다. 웹 앱의 Firebase 설정은 공개되는 것이 정상이고,
   실제 보안은 firestore.rules(서버에서 강제되는 규칙)가 담당한다.
   그러니 이 파일을 그대로 깃에 커밋해도 된다. */

window.MP_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB-jd3YusC2NzeogdnPhn_PKRUGZRWznCg",
  authDomain: "save-my-wallet-8bcf6.firebaseapp.com",
  projectId: "save-my-wallet-8bcf6",
  storageBucket: "save-my-wallet-8bcf6.firebasestorage.app",
  messagingSenderId: "941330623254",
  appId: "1:941330623254:web:5adb19acc2f5767330fe37",
  measurementId: "G-SF4XD4SV2V",
};
