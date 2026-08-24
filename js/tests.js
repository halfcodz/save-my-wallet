/* tests.js — 계산 함수 검증. node로도, tests.html로도 돌아간다. */
(function (root, factory) {
  var calc = root.MP && root.MP.calc ? root.MP.calc : require("./calc.js");
  var model = root.MP && root.MP.model ? root.MP.model : require("./model.js");
  var api = factory(calc, model);
  root.MP = root.MP || {};
  root.MP.tests = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (calc, model) {
  "use strict";

  var results = [];

  function eq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    results.push({ name: name, ok: a === b, actual: a, expected: b });
  }

  function ok(name, cond) {
    results.push({ name: name, ok: !!cond, actual: String(!!cond), expected: "true" });
  }

  /* 헬퍼 */
  var seq = 0;
  function budget(o) {
    return {
      id: o.id || "b1",
      name: o.name || "예산",
      startDate: o.startDate,
      endDate: o.endDate,
      totalAmount: o.totalAmount,
      createdAt: o.createdAt || 1
    };
  }
  function exp(budgetId, amount, date, categoryId, memo) {
    seq += 1;
    return {
      id: "e" + seq,
      budgetId: budgetId,
      amount: amount,
      categoryId: categoryId || "cat_0",
      memo: memo || "",
      date: date,
      createdAt: seq
    };
  }

  function run() {
    results = [];
    seq = 0;

    /* ---------- 1. 날짜 ---------- */
    eq("todayISO: 로컬 날짜 문자열", calc.todayISO(new Date(2026, 7, 22, 23, 59)), "2026-08-22");
    eq("todayISO: 자정 직후도 같은 형식", calc.todayISO(new Date(2026, 7, 23, 0, 0)), "2026-08-23");
    eq("todayISO: 한 자리 월/일 0채움", calc.todayISO(new Date(2026, 0, 5)), "2026-01-05");

    ok("isISODate: 정상", calc.isISODate("2026-08-22"));
    ok("isISODate: 존재하지 않는 날짜 거부", !calc.isISODate("2026-02-30"));
    ok("isISODate: 형식 오류 거부", !calc.isISODate("2026-8-22"));
    ok("isISODate: null 거부", !calc.isISODate(null));

    eq("diffDays: 같은 날 = 0", calc.diffDays("2026-08-22", "2026-08-22"), 0);
    eq("diffDays: 월 경계", calc.diffDays("2026-01-31", "2026-02-02"), 2);
    eq("diffDays: 연 경계", calc.diffDays("2025-12-30", "2026-01-02"), 3);
    eq("diffDays: 윤년 2월", calc.diffDays("2024-02-28", "2024-03-01"), 2);
    eq("diffDays: 평년 2월", calc.diffDays("2025-02-28", "2025-03-01"), 1);
    eq("diffDays: 역방향은 음수", calc.diffDays("2026-08-22", "2026-08-20"), -2);

    eq("addDays: 월 넘김", calc.addDays("2026-08-31", 1), "2026-09-01");
    eq("addDays: 음수", calc.addDays("2026-01-01", -1), "2025-12-31");

    /* ---------- 2. 남은 일수 (오늘 포함) ---------- */
    eq("남은일수: 오늘이 마지막 날이면 1", calc.daysLeft("2026-08-31", "2026-08-31"), 1);
    eq("남은일수: 내일이 마지막 날이면 2", calc.daysLeft("2026-08-30", "2026-08-31"), 2);
    eq("남은일수: 8/22~8/31 = 10", calc.daysLeft("2026-08-22", "2026-08-31"), 10);
    eq("남은일수: 하루 지났으면 0", calc.daysLeft("2026-09-01", "2026-08-31"), 0);
    eq("남은일수: 이틀 지났으면 -1", calc.daysLeft("2026-09-02", "2026-08-31"), -1);

    /* ---------- 3. 예산 상태 ---------- */
    var b = budget({ startDate: "2026-08-01", endDate: "2026-08-31", totalAmount: 800000 });
    eq("상태: 기간 중", calc.budgetStatus(b, "2026-08-22"), "active");
    eq("상태: 시작일 당일", calc.budgetStatus(b, "2026-08-01"), "active");
    eq("상태: 종료일 당일", calc.budgetStatus(b, "2026-08-31"), "active");
    eq("상태: 시작 전", calc.budgetStatus(b, "2026-07-31"), "upcoming");
    eq("상태: 종료됨", calc.budgetStatus(b, "2026-09-01"), "ended");

    /* ---------- 4. 100원 단위 내림 ---------- */
    eq("내림: 14285.71 -> 14200", calc.floorTo100(14285.71), 14200);
    eq("내림: 딱 떨어지면 그대로", calc.floorTo100(14300), 14300);
    eq("내림: 99 -> 0", calc.floorTo100(99), 0);
    eq("내림: 0 -> 0", calc.floorTo100(0), 0);
    eq("내림: 음수도 내림 -1 -> -100", calc.floorTo100(-1), -100);
    eq("내림: 음수 -1234.5 -> -1300", calc.floorTo100(-1234.5), -1300);
    eq("내림: 음수 딱 떨어지면 그대로", calc.floorTo100(-10000), -10000);

    /* ---------- 5. 메인 화면 수치 (손계산 대조) ---------- */
    // 총 800,000 / 8/1~8/31 / 오늘 8/22
    // 지출 9,500 + 4,800 + 1,400 (오늘) + 32,000 + 18,000 (어제) = 65,700
    // 남은 금액 = 800,000 - 65,700 = 734,300
    // 남은 일수 = 31 - 22 + 1 = 10
    // 하루 사용 가능한 금액 = (734,300 + 오늘 쓴 15,700) / 10 = 75,000
    // 오늘 쓸 수 있는 돈 = 75,000 - 15,700 = 59,300
    var e1 = [
      exp("b1", 9500, "2026-08-22", "cat_0", "김치찌개"),
      exp("b1", 4800, "2026-08-22", "cat_1"),
      exp("b1", 1400, "2026-08-22", "cat_3", "지하철"),
      exp("b1", 32000, "2026-08-21", "cat_7", "티셔츠"),
      exp("b1", 18000, "2026-08-21", "cat_2")
    ];
    var s1 = calc.computeBudgetStats(b, e1, "2026-08-22");
    eq("메인: 지출 합계 65,700", s1.spent, 65700);
    eq("메인: 남은 금액 734,300", s1.remaining, 734300);
    eq("메인: 남은 일수 10", s1.daysLeft, 10);
    eq("메인: 하루 사용 가능한 금액 75,000", s1.dailyBudget, 75000);
    eq("메인: 오늘 쓸 수 있는 돈 59,300", s1.todayLeft, 59300);
    eq("메인: 오늘 쓴 돈 15,700", s1.todaySpent, 15700);
    eq("메인: 쓴 만큼 정확히 차감된다", s1.dailyBudget - s1.todayLeft, s1.todaySpent);
    eq("메인: 아직 하루치를 안 넘겼다", s1.overToday, false);
    eq("메인: 종료 아님", s1.ended, false);
    eq("메인: 건수 5", s1.count, 5);

    // 나누어 떨어지지 않는 경우
    // 500,000 - 123,456 = 376,544 / 7일 = 53,792 -> 53,700
    var b2 = budget({ id: "b2", startDate: "2026-08-16", endDate: "2026-08-28", totalAmount: 500000 });
    var e2 = [exp("b2", 123456, "2026-08-20")];
    var s2 = calc.computeBudgetStats(b2, e2, "2026-08-22");
    eq("나머지: 남은 금액 376,544", s2.remaining, 376544);
    eq("나머지: 남은 일수 7", s2.daysLeft, 7);
    eq("나머지: 하루 사용 가능한 금액 53,700", s2.dailyBudget, 53700);
    eq("나머지: 오늘 안 썼으면 하루치가 그대로 남는다", s2.todayLeft, 53700);
    eq("나머지: 오늘 쓴 돈 0", s2.todaySpent, 0);

    /* ---------- 6. 초과 지출: 음수 그대로 ---------- */
    // 100,000 - 150,001 = -50,001 / 5일 = -10,000.2 -> 100원 내림 -> -10,100
    var b3 = budget({ id: "b3", startDate: "2026-08-01", endDate: "2026-08-26", totalAmount: 100000 });
    var e3 = [exp("b3", 150001, "2026-08-10")];
    var s3 = calc.computeBudgetStats(b3, e3, "2026-08-22");
    eq("초과: 남은 금액 음수 그대로", s3.remaining, -50001);
    eq("초과: 남은 일수 5", s3.daysLeft, 5);
    eq("초과: 하루치도 음수", s3.dailyBudget, -10100);
    eq("초과: 오늘 쓸 수 있는 돈도 음수", s3.todayLeft, -10100);
    eq("초과: 게이지는 100%에서 멈춤", s3.spentPct, 100);

    /* ---------- 7. 기간 종료 ---------- */
    var s4 = calc.computeBudgetStats(b, e1, "2026-09-01");
    eq("종료: ended = true", s4.ended, true);
    eq("종료: 하루치 숨김(null)", s4.dailyBudget, null);
    eq("종료: 오늘 쓸 수 있는 돈도 숨김(null)", s4.todayLeft, null);
    eq("종료: 넘김 표시도 끈다", s4.overToday, false);
    eq("종료: 남은 일수 0", s4.daysLeft, 0);
    eq("종료: 남은 금액은 그대로 계산", s4.remaining, 734300);
    eq("종료: 오늘 쓴 돈 0", s4.todaySpent, 0);

    /* ---------- 8. 마지막 날 ---------- */
    var s5 = calc.computeBudgetStats(b, e1, "2026-08-31");
    eq("마지막날: 남은 일수 1", s5.daysLeft, 1);
    eq("마지막날: 하루치 = 남은 금액 내림 734,300", s5.dailyBudget, 734300);
    eq("마지막날: 오늘 쓸 수 있는 돈도 734,300", s5.todayLeft, 734300);

    /* ---------- 9. 다른 예산 지출은 섞이지 않는다 ---------- */
    var mixed = e1.concat([exp("b_other", 999999, "2026-08-22")]);
    var s6 = calc.computeBudgetStats(b, mixed, "2026-08-22");
    eq("격리: 다른 예산 지출 제외", s6.spent, 65700);

    /* ---------- 10. 지출 0건 ---------- */
    var s7 = calc.computeBudgetStats(b, [], "2026-08-22");
    eq("빈 예산: 남은 금액 = 총액", s7.remaining, 800000);
    eq("빈 예산: 하루 사용 가능한 금액 80,000", s7.dailyBudget, 80000);
    eq("빈 예산: 오늘 쓸 수 있는 돈 80,000", s7.todayLeft, 80000);
    eq("빈 예산: 게이지 0%", s7.spentPct, 0);

    /* ---------- 11. 아주 큰 금액 ---------- */
    var bBig = budget({ id: "bg", startDate: "2026-08-01", endDate: "2026-08-31", totalAmount: 999999999 });
    var sBig = calc.computeBudgetStats(bBig, [exp("bg", 999999999, "2026-08-22")], "2026-08-22");
    eq("큰 금액: 남은 금액 0", sBig.remaining, 0);
    // 오늘 999,999,999를 다 썼다: 넘겼으므로 하루치도 남은 돈(0) 기준으로 내려앉는다
    eq("큰 금액: 하루치 0", sBig.dailyBudget, 0);
    eq("큰 금액: 오늘 쓸 수 있는 돈 -900,000,099", sBig.todayLeft, -900000099);
    eq("큰 금액: 하루치를 넘긴 것으로 잡힌다", sBig.overToday, true);
    eq("큰 금액: 포맷", calc.formatWon(999999999), "999,999,999");
    eq("큰 금액: 음수 포맷", calc.formatWon(-999999999), "-999,999,999");

    /* ---------- 12. 금액 입력 ---------- */
    eq("키패드: 1 -> 1", calc.pressKey(0, "1"), 1);
    eq("키패드: 1,2 -> 12", calc.pressKey(1, "2"), 12);
    eq("키패드: 00 붙이기", calc.pressKey(12, "00"), 1200);
    eq("키패드: 지우기", calc.pressKey(1200, "⌫"), 120);
    eq("키패드: 마지막 자리 지우면 0", calc.pressKey(5, "⌫"), 0);
    eq("키패드: 0에서 지워도 0", calc.pressKey(0, "⌫"), 0);
    eq("키패드: 상한 넘으면 무시", calc.pressKey(999999999, "9"), 999999999);
    eq("키패드: 상한 직전은 허용", calc.pressKey(99999999, "9"), 999999999);

    eq("파싱: 콤마 제거", calc.parseAmount("1,234,567"), 1234567);
    eq("파싱: 빈 값 -> 0", calc.parseAmount(""), 0);
    eq("파싱: 문자 섞임", calc.parseAmount("12a3"), 123);
    eq("파싱: 소수점 무시(원 단위 정수)", calc.parseAmount("100.99"), 10099);
    eq("파싱: 상한 적용", calc.parseAmount("99999999999"), 999999999);

    ok("검증: 0은 저장 불가", !calc.isValidAmount(0));
    ok("검증: 음수 저장 불가", !calc.isValidAmount(-100));
    ok("검증: 소수 저장 불가", !calc.isValidAmount(1.5));
    ok("검증: NaN 저장 불가", !calc.isValidAmount(NaN));
    ok("검증: 빈 문자열 저장 불가", !calc.isValidAmount(""));
    ok("검증: 1원 저장 가능", calc.isValidAmount(1));
    ok("검증: 상한 저장 가능", calc.isValidAmount(999999999));
    ok("검증: 상한 초과 불가", !calc.isValidAmount(1000000000));

    /* ---------- 13. 카테고리 삭제: 지출에는 이름이 남는다 ---------- */
    var cats = model.defaultCategories();
    eq("카테고리: 정상 조회", calc.findCategory(cats, "cat_0").name, "식사");
    eq("카테고리: 없으면 null", calc.findCategory(cats, "없는id"), null);

    // 살아 있는 카테고리는 항상 최신 이름을 따라간다 (이름을 고치면 지출에도 반영)
    var live = exp("b1", 5000, "2026-08-22", "cat_0");
    eq("표시: 살아있는 카테고리", calc.resolveCategory(live, cats).name, "식사");
    eq("표시: 삭제 표시 아님", calc.resolveCategory(live, cats).deleted, false);
    var renamed = model.clone(cats);
    renamed[0].name = "밥값";
    eq("표시: 이름 변경이 지출에 반영됨", calc.resolveCategory(live, renamed).name, "밥값");

    // 카테고리 삭제 -> 지출은 남고, 이름/이모지가 지출에 스냅샷된다
    var draft = model.initialData();
    draft.budgets = [budget({ startDate: "2026-08-01", endDate: "2026-08-31", totalAmount: 800000 })];
    draft.expenses = [
      exp("b1", 12500, "2026-08-20", "cat_8", "세제"),
      exp("b1", 7300, "2026-08-20", "cat_13")
    ];
    eq("삭제 전: 사용 건수 1", model.categoryUsageCount(draft, "cat_8"), 1);
    model.deleteCategory(draft, "cat_8");
    eq("삭제 후: 카테고리 13개", draft.categories.length, 13);
    eq("삭제 후: 지출은 그대로 2건", draft.expenses.length, 2);
    eq("삭제 후: 지출에 이름이 남음", draft.expenses[0].categoryName, "생필품");
    eq("삭제 후: 이모지도 남음", draft.expenses[0].categoryEmoji, "🧻");
    eq("삭제 후: 화면 표시 이름 유지", calc.resolveCategory(draft.expenses[0], draft.categories).name, "생필품");
    eq("삭제 후: deleted 플래그", calc.resolveCategory(draft.expenses[0], draft.categories).deleted, true);
    eq("삭제 후: 안 지운 카테고리는 영향 없음", calc.resolveCategory(draft.expenses[1], draft.categories).name, "기타");
    ok("삭제 후: order 재정렬", draft.categories.every(function (c, i) { return c.order === i; }));
    eq("삭제 후: 저장/복원해도 이름 유지", model.sanitize(model.clone(draft)).expenses[0].categoryName, "생필품");

    // 이름 스냅샷이 없는 고아 지출(외부에서 데이터가 깨진 경우)도 화면이 안 깨진다
    var noSnapshot = exp("b1", 100, "2026-08-22", "사라진cat");
    eq("고아: 최후 fallback 이름", calc.resolveCategory(noSnapshot, cats).name, "카테고리 없음");

    // 요약: 삭제된 카테고리도 자기 줄로 남고 '기타'와 섞이지 않는다
    var sh = calc.categoryShares(draft.expenses, draft.categories);
    eq("요약: 두 줄로 분리", sh.length, 2);
    eq("요약: 삭제된 카테고리 이름 유지", sh[0].name, "생필품");
    eq("요약: 기타와 안 섞임", sh[1].name, "기타");
    eq("요약: 합계 유지", sh[0].amount + sh[1].amount, 19800);
    eq("요약: 큰 순서", sh[0].amount, 12500);
    eq("요약: 비율", Math.round(sh[0].pct * 10) / 10, 63.1);

    /* ---------- 14. 날짜별 묶음 ---------- */
    var sorted = calc.expensesOfBudget(e1, "b1");
    eq("정렬: 최신 날짜가 먼저", sorted[0].date, "2026-08-22");
    eq("정렬: 같은 날은 최근 입력이 먼저", sorted[0].amount, 1400);
    var groups = calc.groupByDate(sorted);
    eq("묶음: 2일치", groups.length, 2);
    eq("묶음: 오늘 합계 15,700", groups[0].sum, 15700);
    eq("묶음: 어제 합계 50,000", groups[1].sum, 50000);
    eq("묶음: 라벨", calc.dayLabel("2026-08-22", "2026-08-22"), "오늘 · 8월 22일 (토)");
    eq("묶음: 오늘 아닌 날 라벨", calc.dayLabel("2026-08-21", "2026-08-22"), "8월 21일 (금)");

    eq("기간 라벨", calc.periodLabel(b), "8/1–8/31");

    /* ---------- 15. 카테고리 사용순 정렬 ---------- */
    var ordered = calc.sortCategoriesByUsage(cats, e1, "2026-08-22");
    eq("정렬: 오늘 두 번 쓴 게 아니라 최근순 1위는 식사", ordered[0].name, "식사");
    ok("정렬: 안 쓴 카테고리는 뒤로", ordered.indexOf(calc.findCategory(cats, "cat_5")) > 4);
    eq("정렬: 개수 보존", ordered.length, cats.length);
    var noUse = calc.sortCategoriesByUsage(cats, [], "2026-08-22");
    eq("정렬: 기록 없으면 원래 순서", noUse[0].name, "식사");
    eq("정렬: 기록 없으면 마지막도 원래대로", noUse[noUse.length - 1].name, "기타");

    /* ---------- 16. 스키마 / 정규화 ---------- */
    var init = model.initialData();
    eq("초기: 스키마 버전", init.schemaVersion, 1);
    eq("초기: 예산 없음", init.budgets.length, 0);
    eq("초기: 지출 없음", init.expenses.length, 0);
    eq("초기: 기본 카테고리 14개", init.categories.length, 14);
    eq("초기: activeBudgetId null", init.settings.activeBudgetId, null);
    eq("초기: 테마 light", init.settings.theme, "light");
    ok("초기: 카테고리에 order/isDefault 존재", init.categories[0].order === 0 && init.categories[0].isDefault === true);

    eq("정규화: null 입력", model.sanitize(null).budgets.length, 0);
    eq("정규화: 이상한 입력", model.sanitize("hello").categories.length, 14);

    var dirty = {
      schemaVersion: 1,
      budgets: [
        { id: "ok", name: "  ", startDate: "2026-08-01", endDate: "2026-08-31", totalAmount: "800000.4" },
        { id: "bad", startDate: "2026-13-01", endDate: "2026-08-31", totalAmount: 1 },
        { id: "flip", name: "뒤집힘", startDate: "2026-08-31", endDate: "2026-08-01", totalAmount: 100 }
      ],
      expenses: [
        { id: "e1", budgetId: "ok", amount: 1500.6, categoryId: "cat_0", date: "2026-08-22" },
        { id: "e2", budgetId: "없는예산", amount: 100, categoryId: "cat_0", date: "2026-08-22" },
        { id: "e3", budgetId: "ok", amount: 0, categoryId: "cat_0", date: "2026-08-22" },
        { id: "e4", budgetId: "ok", amount: 100, categoryId: "cat_0", date: "날짜아님" }
      ],
      settings: { activeBudgetId: "없는예산", theme: "dark" }
    };
    var clean = model.sanitize(dirty);
    eq("정규화: 잘못된 날짜 예산 제거", clean.budgets.length, 2);
    eq("정규화: 빈 이름 기본값", clean.budgets[0].name, "예산");
    eq("정규화: 금액 정수화", clean.budgets[0].totalAmount, 800000);
    eq("정규화: 뒤집힌 기간 보정", clean.budgets[1].endDate, "2026-08-31");
    eq("정규화: 유효한 지출만 남음", clean.expenses.length, 1);
    eq("정규화: 지출 금액 정수화", clean.expenses[0].amount, 1501);
    eq("정규화: 없는 예산 가리키면 첫 예산으로", clean.settings.activeBudgetId, "ok");
    eq("정규화: 테마 유지", clean.settings.theme, "dark");
    eq("정규화: 스키마 버전 부여", clean.schemaVersion, 1);

    var noVersion = model.migrate({ budgets: [], expenses: [], categories: [], settings: {} });
    eq("마이그레이션: 버전 필드 없어도 v1로", noVersion.schemaVersion, 1);
    eq("마이그레이션: 카테고리 비면 기본값 복구", noVersion.categories.length, 14);

    var future = model.migrate({ schemaVersion: 99, budgets: [], expenses: [], categories: [], settings: {} });
    ok("마이그레이션: 미래 버전도 죽지 않음", future.categories.length === 14);

    /* ---------- 17. 함께 쓰는 예산: 사람별 합계와 정산 ---------- */
    var trip = model.normalizeBudget({
      id: "t1",
      name: "부산 여행",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      totalAmount: 300000,
      ownerUid: "u1",
      memberUids: ["u1", "u2", "u3"],
      members: { u1: { name: "지민" }, u2: { name: "예은" }, u3: { name: "하늘" } }
    });
    ok("공유: 둘 이상이면 함께 쓰는 예산", trip.shared);
    eq("공유: 멤버 3명", trip.memberUids.length, 3);

    var solo = model.normalizeBudget({
      id: "s1", startDate: "2026-08-01", endDate: "2026-08-03",
      totalAmount: 1000, ownerUid: "u1", memberUids: ["u1"]
    });
    ok("공유: 혼자면 함께 쓰는 예산이 아님", !solo.shared);
    ok("공유: 만든 사람은 멤버에 자동 포함", solo.memberUids[0] === "u1");

    var withCode = model.normalizeBudget({
      id: "c1", startDate: "2026-08-01", endDate: "2026-08-03",
      totalAmount: 1000, ownerUid: "u1", memberUids: ["u1"], inviteCode: "K7QMB4XZ"
    });
    ok("공유: 초대 코드가 켜져 있으면 함께 쓰는 예산", withCode.shared);
    eq("공유: 잘못된 코드는 버린다", model.normalizeBudget({
      id: "c2", startDate: "2026-08-01", endDate: "2026-08-03",
      totalAmount: 1000, ownerUid: "u1", memberUids: ["u1"], inviteCode: "짧음"
    }).inviteCode, null);

    eq("함께: 나를 앞에 두고 이름을 나열", calc.memberNames(trip, "u2"), "나 · 지민 · 하늘");
    eq("함께: 나도 이름으로 보이지 않는다", calc.memberNames(trip, "u1"), "나 · 예은 · 하늘");
    eq("함께: 혼자면 나만", calc.memberNames(solo, "u1"), "나");
    eq("함께: 남의 예산이면 나는 빠진다", calc.memberNames(trip, "없는uid"), "지민 · 예은 · 하늘");
    eq("함께: 많으면 뒤를 접는다", calc.memberNames({
      memberUids: ["u1", "u2", "u3", "u4", "u5"],
      members: { u1: { name: "지민" }, u2: { name: "예은" }, u3: { name: "하늘" }, u4: { name: "도윤" }, u5: { name: "서아" } }
    }, "u1"), "나 · 예은 · 하늘 외 2명");
    eq("함께: 멤버가 없으면 빈 문자열", calc.memberNames({}, "u1"), "");

    var chips = calc.memberInitials(trip, "u2");
    eq("동그라미: 나부터", chips.people[0].initial, "나");
    ok("동그라미: 나 표시", chips.people[0].isMe);
    eq("동그라미: 나머지는 이름 첫 글자", chips.people[1].initial, "지");
    eq("동그라미: 인원 수만큼", chips.people.length, 3);
    eq("동그라미: 접힌 사람 없음", chips.more, 0);
    ok("동그라미: 나 말고는 isMe 아님", !chips.people[1].isMe);

    var many = calc.memberInitials({
      memberUids: ["u1", "u2", "u3", "u4", "u5", "u6"],
      members: { u1: { name: "지민" }, u2: { name: "예은" }, u3: { name: "하늘" },
                 u4: { name: "도윤" }, u5: { name: "서아" }, u6: { name: "민준" } }
    }, "u1");
    eq("동그라미: 기본 4개까지", many.people.length, 4);
    eq("동그라미: 나머지는 숫자로", many.more, 2);

    eq("동그라미: 멤버 없으면 빈 목록", calc.memberInitials({}, "u1").people.length, 0);
    eq("동그라미: 이름 없으면 물음표 대신 기본 이름 첫 글자",
      calc.memberInitials({ memberUids: ["u9"], members: {} }, "u1").people[0].initial, "알");
    eq("함께: 이름 없는 사람도 자리는 있다", calc.memberNames({ memberUids: ["u1", "u9"], members: { u1: { name: "지민" } } }, "u1"), "나 · 알 수 없음");

    var tripExp = [
      { uid: "u1", amount: 60000 },
      { uid: "u2", amount: 30000 }
    ];
    var shares = calc.memberShares(tripExp, trip);
    eq("사람별: 안 쓴 사람도 자기 줄을 갖는다", shares.length, 3);
    eq("사람별: 많이 쓴 순", shares[0].name, "지민");
    eq("사람별: 두 번째", shares[1].name, "예은");
    eq("사람별: 한 푼도 안 쓴 사람은 0원", shares[2].amount, 0);
    eq("사람별: 비율", Math.round(shares[0].pct), 67);

    var moves = calc.settlement(shares);
    eq("정산: 한 번만 보내면 끝", moves.length, 1);
    eq("정산: 덜 낸 사람이 보낸다", moves[0].fromName, "하늘");
    eq("정산: 더 낸 사람이 받는다", moves[0].toName, "지민");
    eq("정산: 금액은 1인당 몫과의 차이", moves[0].amount, 30000);

    var even = calc.memberShares(
      [{ uid: "u1", amount: 10000 }, { uid: "u2", amount: 10000 }, { uid: "u3", amount: 10000 }],
      trip
    );
    eq("정산: 똑같이 냈으면 주고받을 게 없다", calc.settlement(even).length, 0);
    eq("정산: 아무도 안 썼으면 빈 목록", calc.settlement(calc.memberShares([], trip)).length, 0);
    eq("정산: 혼자면 정산 없음", calc.settlement(calc.memberShares([{ uid: "u1", amount: 100 }], solo)).length, 0);

    // 나간 사람이 적어 둔 내역도 이름을 잃지 않는다
    var leftBehind = calc.memberShares([{ uid: "u9", amount: 5000, userName: "손님" }], trip);
    eq("사람별: 나간 사람 이름은 지출에 남은 것으로", leftBehind[0].name, "손님");
    eq("사람별: 이름도 uid도 없으면 기본값", calc.memberShares([{ amount: 100 }], solo)[0].name, "알 수 없음");

    // 송금 횟수는 인원수를 넘지 않는다 (금액이 지저분해도)
    var messy = calc.memberShares(
      [{ uid: "u1", amount: 10000 }, { uid: "u2", amount: 1 }],
      trip
    );
    ok("정산: 송금 횟수는 인원수 미만", calc.settlement(messy).length < 3);
    ok("정산: 금액은 모두 양수 정수", calc.settlement(messy).every(function (m) {
      return m.amount > 0 && Math.floor(m.amount) === m.amount;
    }));

    /* ---------- 18. 초대 코드 ---------- */
    eq("초대코드: 8자리", model.newInviteCode().length, 8);
    ok("초대코드: 헷갈리는 글자(I,O,0,1)를 쓰지 않는다", !/[IO01]/.test(model.newInviteCode()));
    eq("초대코드: 소문자·공백·하이픈 정리", model.normalizeInviteCode(" k7-qmb 4xz "), "K7QMB4XZ");
    eq("초대코드: 0은 O로, 1은 I로 고쳐 받는다", model.normalizeInviteCode("0AB1CDEF"), "OABICDEF");
    eq("초대코드: 길이 초과는 자른다", model.normalizeInviteCode("ABCDEFGHIJK").length, 8);
    ok("초대코드: 짧으면 거부", !model.isInviteCode("ABC"));
    ok("초대코드: 방금 만든 코드는 유효", model.isInviteCode(model.newInviteCode()));

    /* ---------- 18.5 이메일 형식 ---------- */
    ok("이메일: 평범한 주소", model.isEmail("a@test.com"));
    ok("이메일: 점이 여러 개인 도메인", model.isEmail("me@mail.co.kr"));
    ok("이메일: 앞뒤 공백은 무시", model.isEmail("  me@mail.com  "));
    ok("이메일: 플러스 표기 허용", model.isEmail("me+trip@mail.com"));
    ok("이메일: @가 없으면 거부", !model.isEmail("test.com"));
    ok("이메일: 도메인에 점이 없으면 거부", !model.isEmail("a@b"));
    ok("이메일: 최상위가 한 글자면 거부", !model.isEmail("a@b.c"));
    ok("이메일: 아이디가 없으면 거부", !model.isEmail("@test.com"));
    ok("이메일: 도메인이 없으면 거부", !model.isEmail("a@"));
    ok("이메일: 공백이 섞이면 거부", !model.isEmail("a b@test.com"));
    ok("이메일: @가 두 개면 거부", !model.isEmail("a@b@test.com"));
    ok("이메일: 빈 값 거부", !model.isEmail(""));
    ok("이메일: 문자열이 아니면 거부", !model.isEmail(null));
    eq("비밀번호 최소 길이", model.MIN_PASSWORD, 6);

    /* ---------- 19. 지출에 누가 썼는지 ---------- */
    var withUser = model.normalizeExpense({
      id: "x1", budgetId: "t1", amount: 100, date: "2026-08-01",
      uid: " u1 ", userName: " 지민 "
    });
    eq("지출: 작성자 uid 보존", withUser.uid, "u1");
    eq("지출: 작성자 이름 공백 정리", withUser.userName, "지민");
    ok("지출: 작성자 정보가 없어도 정상", model.normalizeExpense({
      id: "x2", budgetId: "t1", amount: 100, date: "2026-08-01"
    }).uid === undefined);

    /* ---------- 19.5 나의 가계부: 달마다 이어진다 ---------- */
    eq("달 경계: 8월", calc.monthBounds("2026-08-22"), { start: "2026-08-01", end: "2026-08-31" });
    eq("달 경계: 2월(평년)", calc.monthBounds("2026-02-10").end, "2026-02-28");
    eq("달 경계: 2월(윤년)", calc.monthBounds("2024-02-10").end, "2024-02-29");
    eq("달 경계: 12월 말일", calc.monthBounds("2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
    eq("달 이름", calc.monthLabel("2026-08-22"), "8월");
    eq("달 이름: 한 자리 달", calc.monthLabel("2026-01-05"), "1월");

    var mine = model.normalizeBudget({
      id: "p1", kind: "personal", name: "나의 가계부",
      startDate: "2026-06-01", endDate: "2026-06-30", // 만들었을 때의 달
      totalAmount: 600000, ownerUid: "u1", memberUids: ["u1"]
    });
    eq("나의 가계부: 종류", mine.kind, "personal");
    ok("나의 가계부: 함께 쓰지 않는다", !mine.shared);
    ok("나의 가계부: 판별", calc.isPersonal(mine) && !calc.isPersonal(trip));

    var eff = calc.effectiveBudget(mine, "2026-08-22");
    eq("나의 가계부: 오늘이 속한 달로 본다 (시작)", eff.startDate, "2026-08-01");
    eq("나의 가계부: 오늘이 속한 달로 본다 (종료)", eff.endDate, "2026-08-31");
    eq("나의 가계부: 원본은 건드리지 않는다", mine.startDate, "2026-06-01");
    eq("여행 예산: 기간을 그대로 쓴다", calc.effectiveBudget(trip, "2026-08-22").startDate, trip.startDate);

    var mineExp = [
      exp("p1", 10000, "2026-08-05"),
      exp("p1", 20000, "2026-08-22"),
      exp("p1", 50000, "2026-07-30"), // 지난 달
      exp("p1", 70000, "2026-09-02")  // 다음 달
    ];
    eq("나의 가계부: 이번 달 것만 센다", calc.budgetExpenses(mineExp, mine, "2026-08-22").length, 2);
    eq("여행 예산: 소속만 보고 거른다", calc.budgetExpenses(mineExp, trip, "2026-08-22").length, 0);

    var ms = calc.computeBudgetStats(mine, mineExp, "2026-08-22");
    eq("나의 가계부: 이번 달 합계", ms.spent, 30000);
    eq("나의 가계부: 남은 금액", ms.remaining, 570000);
    eq("나의 가계부: 이번 달 남은 일수", ms.daysLeft, 10);
    eq("나의 가계부: 달 안이면 진행 중", ms.status, "active");
    eq("나의 가계부: 오늘 쓴 돈", ms.todaySpent, 20000);
    // (570,000 + 20,000) / 10 = 59,000 -> 오늘 20,000 썼으니 39,000 남았다
    eq("나의 가계부: 하루 사용 가능한 금액 59,000", ms.dailyBudget, 59000);
    eq("나의 가계부: 오늘 쓸 수 있는 돈 39,000", ms.todayLeft, 39000);

    var nextMonth = calc.computeBudgetStats(mine, mineExp, "2026-09-02");
    eq("달이 바뀌면 지출도 새 달 것만", nextMonth.spent, 70000);
    eq("달이 바뀌어도 예산은 그대로", nextMonth.total, 600000);
    eq("달이 바뀌어도 끝나지 않는다", nextMonth.status, "active");
    eq("달이 바뀌면 남은 일수도 새 달 기준", nextMonth.daysLeft, 29);

    /* ---------- 19.7 달력 격자 ---------- */
    var grid = calc.monthGrid("2026-08-15");
    eq("달력: 항상 6주", grid.length, 6);
    eq("달력: 한 주 7칸", grid[0].length, 7);
    eq("달력: 첫 칸은 그 주 일요일", grid[0][0].date, "2026-07-26");
    eq("달력: 마지막 칸", grid[5][6].date, "2026-09-05");
    eq("달력: 8월 1일은 토요일 자리", grid[0][6].date, "2026-08-01");
    ok("달력: 앞선 달 칸은 이번 달이 아님", grid[0].slice(0, 6).every(function (c) { return !c.inMonth; }));
    ok("달력: 8월 1일은 이번 달", grid[0][6].inMonth);
    eq("달력: 이번 달 칸 수 = 31", grid.reduce(function (n, w) {
      return n + w.filter(function (c) { return c.inMonth; }).length;
    }, 0), 31);
    eq("달력: 2월(평년) 칸 수 = 28", calc.monthGrid("2026-02-10").reduce(function (n, w) {
      return n + w.filter(function (c) { return c.inMonth; }).length;
    }, 0), 28);
    ok("달력: 칸은 하루씩 이어진다", (function () {
      var flat = [];
      grid.forEach(function (w) { flat = flat.concat(w); });
      for (var i = 1; i < flat.length; i++) {
        if (calc.diffDays(flat[i - 1].date, flat[i].date) !== 1) return false;
      }
      return flat.length === 42;
    })());

    eq("달 이동: 다음 달 1일", calc.addMonths("2026-08-15", 1), "2026-09-01");
    eq("달 이동: 연 경계 뒤로", calc.addMonths("2026-01-10", -1), "2025-12-01");
    eq("달 이동: 연 경계 앞으로", calc.addMonths("2026-12-31", 1), "2027-01-01");

    var idx = calc.indexByDate([
      exp("b1", 1000, "2026-08-22"),
      exp("b1", 2000, "2026-08-22"),
      exp("b1", 500, "2026-08-21")
    ]);
    eq("날짜별 색인: 합계", idx["2026-08-22"].sum, 3000);
    eq("날짜별 색인: 건수", idx["2026-08-22"].items.length, 2);
    eq("날짜별 색인: 다른 날", idx["2026-08-21"].sum, 500);
    ok("날짜별 색인: 없는 날은 undefined", idx["2026-08-20"] === undefined);

    /* ---------- 19.8 한도 없이 기록만 하는 가계부 ---------- */
    var free = model.normalizeBudget({
      id: "f1", kind: "personal", name: "나의 가계부",
      startDate: "2026-08-01", endDate: "2026-08-31",
      totalAmount: 0, ownerUid: "u1", memberUids: ["u1"]
    });
    eq("한도 없음: 기본 기간은 매달", free.periodMode, "month");

    var freeStats = calc.computeBudgetStats(free, [
      exp("f1", 30000, "2026-08-01"),
      exp("f1", 20000, "2026-08-05")
    ], "2026-08-05");
    ok("한도 없음: hasLimit false", !freeStats.hasLimit);
    eq("한도 없음: 쓴 돈은 그대로 센다", freeStats.spent, 50000);
    eq("한도 없음: 5일째", freeStats.elapsedDays, 5);
    eq("한도 없음: 하루 평균 10,000", freeStats.avgPerDay, 10000);
    eq("한도 없음: 게이지는 0%", freeStats.spentPct, 0);

    var limited = model.normalizeBudget({
      id: "f2", kind: "personal", startDate: "2026-08-01", endDate: "2026-08-31",
      totalAmount: 600000, ownerUid: "u1", memberUids: ["u1"]
    });
    ok("한도 있음: hasLimit true", calc.computeBudgetStats(limited, [], "2026-08-05").hasLimit);

    /* 직접 지정한 기간은 달이 바뀌어도 그대로 */
    var fixed = model.normalizeBudget({
      id: "f3", kind: "personal", periodMode: "custom",
      startDate: "2026-08-10", endDate: "2026-09-09",
      totalAmount: 300000, ownerUid: "u1", memberUids: ["u1"]
    });
    eq("직접 지정: 기간 유지 (시작)", calc.effectiveBudget(fixed, "2026-09-02").startDate, "2026-08-10");
    eq("직접 지정: 기간 유지 (종료)", calc.effectiveBudget(fixed, "2026-09-02").endDate, "2026-09-09");
    eq("직접 지정: 달을 넘긴 지출도 센다", calc.computeBudgetStats(fixed, [
      exp("f3", 10000, "2026-08-20"),
      exp("f3", 20000, "2026-09-02")
    ], "2026-09-02").spent, 30000);

    /* ---------- 20. 자정 넘김 ---------- */
    var beforeMidnight = calc.computeBudgetStats(b, e1, "2026-08-22");
    var afterMidnight = calc.computeBudgetStats(b, e1, "2026-08-23");
    eq("자정: 남은 일수 하루 줄어듦", beforeMidnight.daysLeft - afterMidnight.daysLeft, 1);
    eq("자정: 오늘 쓴 돈 0으로 리셋", afterMidnight.todaySpent, 0);
    eq("자정: 남은 금액은 그대로", afterMidnight.remaining, beforeMidnight.remaining);
    // 어제 하루치(75,000)보다 적게 썼으므로 오늘 하루치가 올라간다
    eq("자정: 하루치 다시 계산 81,500", afterMidnight.dailyBudget, 81500);
    ok("자정: 아껴 썼으면 하루치가 올라간다", afterMidnight.dailyBudget > beforeMidnight.dailyBudget);
    eq("자정: 오늘 쓴 게 없으니 하루치가 그대로 남는다", afterMidnight.todayLeft, afterMidnight.dailyBudget);

    /* ---------- 20.5 하루치는 오늘 안에서 흔들리지 않는다 ---------- */
    var day0 = calc.computeBudgetStats(b, [], "2026-08-22");
    var day1 = calc.computeBudgetStats(b, [exp("b1", 30000, "2026-08-22")], "2026-08-22");
    var day2 = calc.computeBudgetStats(b, [exp("b1", 30000, "2026-08-22"), exp("b1", 60000, "2026-08-22")], "2026-08-22");
    // 하루치(80,000) 안에서 쓰는 동안은 하루치가 흔들리지 않는다
    eq("같은 날: 하루치는 그대로 (지출 전)", day0.dailyBudget, 80000);
    eq("같은 날: 하루치는 그대로 (3만원 씀)", day1.dailyBudget, 80000);
    eq("같은 날: 오늘 쓸 수 있는 돈만 줄어든다", day1.todayLeft, 50000);
    eq("같은 날: 넘기기 전엔 표시 없음", day1.overToday, false);

    // 넘기는 순간 하루치(평균)도 즉시 낮아진다: 남은 710,000을 내일부터 9일로 다시 나눈다
    eq("넘기면 하루치도 낮아진다", day2.dailyBudget, 78800);
    ok("넘기면 하루치가 내려간다", day2.dailyBudget < day0.dailyBudget);
    eq("같은 날: 넘기면 음수로 내려간다", day2.todayLeft, -10000);
    eq("같은 날: 넘기면 게이지 빗금", day2.overToday, true);

    // 넘긴 순간 보이던 하루치가 다음 날 그대로 이어진다
    var nextDay = calc.computeBudgetStats(b, [exp("b1", 30000, "2026-08-22"), exp("b1", 60000, "2026-08-22")], "2026-08-23");
    eq("넘겨 쓴 다음 날 하루치가 그대로 이어진다", nextDay.dailyBudget, day2.dailyBudget);
    eq("넘겨 쓴 다음 날 하루치 78,800", nextDay.dailyBudget, 78800);
    eq("다음 날은 아직 안 썼으니 하루치가 그대로 남는다", nextDay.todayLeft, 78800);

    // 마지막 날에 넘기면 나눌 날이 없다 -> 남은 금액을 그대로 본다
    var lastOver = calc.computeBudgetStats(b, [exp("b1", 900000, "2026-08-31")], "2026-08-31");
    eq("마지막날 초과: 남은 금액 -100,000", lastOver.remaining, -100000);
    eq("마지막날 초과: 하루치는 남은 금액 그대로", lastOver.dailyBudget, -100000);
    eq("마지막날 초과: 오늘 쓸 수 있는 돈", lastOver.todayLeft, 800000 - 900000);

    /* ---------- 20.7 달력에서 고른 하루 ---------- */
    // b: 800,000 / 2026-08-01~08-31. 8/21에 아무것도 안 썼다면 하루치 = 800,000 / 11
    var dayA = calc.computeDayStats(b, [], "2026-08-21");
    eq("그날: 남은 일수 11", dayA.daysLeft, 11);
    eq("그날: 하루 사용 가능한 금액 72,700", dayA.dailyBudget, 72700);
    eq("그날: 쓴 게 없으면 하루치가 그대로", dayA.dayLeft, 72700);
    eq("그날: 쓴 돈 0", dayA.daySpent, 0);

    // 8/21 이전에 100,000을 썼고, 8/21에 20,000을 썼다
    var dayExp = [exp("b1", 100000, "2026-08-10"), exp("b1", 20000, "2026-08-21")];
    var dayB = calc.computeDayStats(b, dayExp, "2026-08-21");
    eq("그날: 그 전 지출만 빼서 다시 나눈다", dayB.dailyBudget, 63600); // 700,000 / 11 = 63,636
    eq("그날: 쓴 만큼 차감", dayB.dayLeft, 43600);
    eq("그날: 그날 쓴 돈", dayB.daySpent, 20000);
    eq("그날: 건수", dayB.count, 1);

    // 그날 이후에 쓴 돈은 아직 없던 것으로 본다
    var later = dayExp.concat([exp("b1", 500000, "2026-08-25")]);
    eq("그날: 이후 지출은 섞이지 않는다", calc.computeDayStats(b, later, "2026-08-21").dailyBudget, 63600);

    // 오늘을 고르면 홈 화면과 같은 숫자
    var homeToday = calc.computeBudgetStats(b, e1, "2026-08-22");
    var dayToday = calc.computeDayStats(b, e1, "2026-08-22");
    eq("그날=오늘: 하루치가 홈과 같다", dayToday.dailyBudget, homeToday.dailyBudget);
    eq("그날=오늘: 쓸 수 있는 돈이 홈과 같다", dayToday.dayLeft, homeToday.todayLeft);
    eq("그날=오늘: 쓴 돈이 홈과 같다", dayToday.daySpent, homeToday.todaySpent);

    // 그날 넘겨 썼으면 하루치도 다음 날 기준으로 낮아진다
    var dayOver = calc.computeDayStats(b, [exp("b1", 200000, "2026-08-21")], "2026-08-21");
    eq("그날 초과: 넘긴 것으로 잡힌다", dayOver.over, true);
    eq("그날 초과: 쓸 수 있던 돈은 음수", dayOver.dayLeft, 72700 - 200000);
    eq("그날 초과: 하루치는 다음 날부터 다시 나눈 값", dayOver.dailyBudget, 60000); // 600,000 / 10

    // 기간 밖 날짜와 한도 없는 가계부는 숨긴다
    ok("기간 밖 날짜는 못 쓴다", !calc.computeDayStats(b, [], "2026-09-05").usable);
    ok("시작 전 날짜도 못 쓴다", !calc.computeDayStats(b, [], "2026-07-31").usable);
    eq("기간 밖이어도 그날 쓴 돈은 센다", calc.computeDayStats(b, [], "2026-09-05").daySpent, 0);

    eq("그날: 라벨용 짧은 날짜", calc.shortDate("2026-08-21"), "8/21");

    return results;
  }

  return {
    run: run,
    get results() {
      return results;
    }
  };
});
