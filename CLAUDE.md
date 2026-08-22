# CLAUDE.md

이 저장소에서 작업할 때 지켜야 할 것들.

## 이 앱이 뭔가

기간과 총액을 정하면 오늘 쓸 수 있는 돈을 알려주는 가계부 PWA.
로그인해서 쓰고, 여행 갈 때는 초대 코드로 같이 가는 사람과 하나의 가계부를 함께 쓴다.

- 배포: GitHub Pages (`https://halfcodz.github.io/save-my-wallet/`), `main` 브랜치 루트
- 백엔드: Firebase (Authentication + Cloud Firestore), **Spark 무료 플랜**
- 사용 규모: 10명 미만

## 절대 지켜야 할 제약

1. **비용이 들면 안 된다.** Firebase는 Spark 플랜만 쓴다. Blaze(종량제)로 올리자고 제안하지 말 것.
   Cloud Functions, Firebase Hosting, Cloud Storage 등 Spark에서 제한되거나 결제 수단이 필요한
   기능은 도입하지 않는다. 지금 구성(Auth + Firestore + GitHub Pages)만으로 끝낸다.
2. **빌드 도구 없음.** 번들러, 트랜스파일러, npm 의존성을 앱에 추가하지 않는다.
   파일을 그대로 서빙하는 것이 배포다. (`js/smoke.node.js`만 예외적으로 jsdom을 쓰는데,
   이건 개발용 검증이고 앱은 이 파일 없이 동작한다.)
3. **ES5 문법으로 쓴다.** `var`, `function`, 화살표 함수·`const`·템플릿 리터럴 금지.
   기존 코드 스타일이 그렇고, 구형 iOS 사파리를 염두에 둔 것이다.
   (`js/smoke.node.js`는 node 전용이라 최신 문법을 써도 된다.)
4. **디자인 값을 바꾸지 않는다.** 인라인 style 문자열의 픽셀·색·굵기 값은 원본 디자인이다.
   레이아웃이 필요해서 손대야 하면 그 이유를 코멘트로 남긴다.
5. **주석과 UI 문구는 한국어.**

## 파일 구조

| 파일 | 하는 일 | node에서 테스트 가능 |
| --- | --- | --- |
| `js/calc.js` | 순수 계산·포맷. 날짜, 금액, 집계, 사람별 정산 | O |
| `js/model.js` | 순수 데이터 모델. 정규화, 기본 카테고리, 초대 코드 | O |
| `js/auth.js` | Firebase 초기화, 로그인·회원가입·로그아웃 | X (브라우저 전역 `firebase` 필요) |
| `js/store.js` | Firestore 데이터 레이어. 실시간 구독 + 쓰기 | X |
| `js/refresh.js` | 서비스 워커 업데이트, 당겨서 새로고침 | X |
| `js/app.js` | 화면 렌더링과 이벤트 | X |
| `js/firebase-config.js` | 사용자가 자기 Firebase 설정을 넣는 곳 | — |
| `firestore.rules` | 서버가 강제하는 접근 규칙 | — |
| `sw.js` | 오프라인 캐시 | — |

**계산이나 데이터 변형 로직은 되도록 `calc.js` / `model.js`에 넣는다.**
이 둘은 DOM도 저장소도 모르는 순수 함수라서 node로 바로 검증되고, 회귀를 잡아 준다.

### 화면과 코드를 잇는 규칙

`index.html`은 마크업만 들고 있고, `app.js`가 값을 꽂는다.

- `data-el="이름"` → `el("이름")`, `text("이름", 값)`, `css("이름", 스타일)`
- `data-show="이름"` → `show("이름", 조건)` — `.mm-hide`로 숨긴다
- `data-act="이름"` → `ACTIONS.이름` (document 위임 클릭)

새 훅을 추가하면 반드시 양쪽을 다 고친다. 아래 검증이 어긋난 것을 잡아 준다.

## 작업할 때마다 하는 것 (빌드 → 검증 → 배포)

빌드 단계가 따로 없으므로 **검증과 배포가 곧 빌드다.** 코드를 고쳤으면 아래를 끝까지 진행한다.

### 1. 검증

```bash
node js/run-tests.node.js      # 계산·데이터 함수 (의존성 없음, 항상 돌린다)
node js/smoke.node.js          # 앱 전체 구동 (jsdom 필요, 없으면 스스로 건너뛴다)
```

`js/smoke.node.js`는 실제 `index.html`을 jsdom에 띄우고 Firebase를 메모리 가짜로 바꿔서
회원가입 → 예산 생성 → 지출 입력 → 되돌리기 → 초대 코드 → 상대 지출 동기화 → 정산 →
테마 → 로그아웃 → 재로그인 → 초대 코드로 참여까지 실제로 눌러 본다.
**UI나 데이터 흐름을 고쳤으면 이 테스트도 함께 고친다.**

없으면 한 번만: `npm i jsdom` (`node_modules/`는 `.gitignore`에 있다)

### 2. 캐시 버전 올리기

**앱 파일(`index.html`, `css/`, `js/`)을 하나라도 고쳤으면 `sw.js`의 `VERSION`을 올린다.**

```js
var VERSION = "v2";   // -> "v3"
```

이걸 빼먹으면 이미 설치된 기기가 옛 화면을 계속 보게 된다.
`js/` 아래에 파일을 새로 만들었으면 `sw.js`의 `SHELL` 배열에도 넣는다.

### 3. 배포

GitHub Pages가 `main` 브랜치를 그대로 서빙한다. **push가 곧 배포다.**

```bash
git add -A
git commit -m "무엇을 왜 바꿨는지"
git push origin main
```

1~2분 뒤 반영된다. 기기에서는 화면을 위에서 아래로 당기면 새 버전을 확인한다.

> 사용자가 이 저장소에서 "빌드/배포까지 해 달라"고 이미 요청해 두었다.
> 코드 변경 작업을 마쳤으면 위 3단계를 물어보지 말고 끝까지 진행한다.
> 다만 `main`에 바로 push하므로, 되돌리기 어려운 큰 변경이면 먼저 알린다.

## 사용자가 직접 해야 하는 것 (Claude가 못 하는 것)

이건 Firebase 콘솔에서 사람이 눌러야 한다. 코드로 대신할 수 없다.

- `firestore.rules`를 고쳤으면 → **Firebase 콘솔 → Firestore Database → 규칙 → 붙여넣고 게시**
- 새 도메인에서 앱을 열려면 → **Authentication → Settings → 승인된 도메인**에 추가
- `js/firebase-config.js` 채우기

**`firestore.rules`를 고쳤으면 그 사실과 게시 방법을 사용자에게 반드시 알린다.**
규칙을 게시하지 않으면 앱이 조용히 "권한이 없습니다"만 띄운다.

## 데이터 구조 (Firestore)

```
users/{uid}                        displayName, email, theme, activeBudgetId, categories[]
budgets/{budgetId}                 name, startDate, endDate, totalAmount, createdAt,
                                   ownerUid, memberUids[], members{uid:{name}}, inviteCode
budgets/{budgetId}/expenses/{id}   amount, categoryId, categoryName, categoryEmoji,
                                   memo, date, createdAt, uid, userName
invites/{code}                     budgetId, ownerUid, createdAt
```

알아 둘 것:

- **지출에 카테고리 이름·이모지를 항상 함께 저장한다.** 같이 쓰는 사람의 카테고리 목록은
  나와 다를 수 있어서, 이름을 안 남기면 상대 화면에서 "카테고리 없음"이 된다.
- **지출에 `uid`/`userName`을 남긴다.** 사람별 합계와 정산이 여기에 의존한다.
- **`budget.shared`는 저장하지 않고 계산한다** (`memberUids.length > 1 || inviteCode`).
  `model.normalizeBudget`이 담당한다.
- 예산 하나당 지출 구독을 하나씩 붙인다 (`store.js`의 `syncExpenseWatchers`).
- 화면은 항상 `store.get()`이 주는 한 덩어리만 본다. 모양은 예전 localStorage 시절과 같다.

## 자주 건드리게 되는 것들

**아이폰 상태바(다이나믹 아일랜드)**
`apple-mobile-web-app-status-bar-style=black-translucent` + `[data-safe-top]`의
`padding-top: env(safe-area-inset-top)`로 처리한다. 전체 화면 오버레이를 새로 만들면
그 요소에도 `data-safe-top`을 붙여야 내용이 아일랜드에 가리지 않는다.

**당겨서 새로고침**
`refresh.js`의 `pullToRefresh`가 `[data-el="frame"]`에 touch 리스너를 붙인다.
새 오버레이를 만들면 `app.js`의 `canPull()`에 그 상태를 추가해서, 오버레이가 열려 있을 때는
당기기가 동작하지 않게 한다. (가로 스와이프 삭제와도 겹치지 않도록 되어 있다.)

**서비스 워커 캐시 전략**
같은 출처 파일은 네트워크 우선(4초 타임아웃 후 캐시), 외부 파일은 캐시 우선 + 뒤에서 갱신.
Firebase 통신 호스트는 `BYPASS_HOSTS`로 아예 가로채지 않는다. **여기에 손대지 말 것** —
캐시된 응답이 섞이면 로그인과 실시간 동기화가 깨진다.
