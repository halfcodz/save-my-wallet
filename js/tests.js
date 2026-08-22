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
    // 오늘 쓸 수 있는 돈 = 734,300 / 10 = 73,430 -> 100원 내림 -> 73,400
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
    eq("메인: 오늘 쓸 수 있는 돈 73,400", s1.perDay, 73400);
    eq("메인: 오늘 쓴 돈 15,700", s1.todaySpent, 15700);
    eq("메인: 종료 아님", s1.ended, false);
    eq("메인: 건수 5", s1.count, 5);

    // 나누어 떨어지지 않는 경우
    // 500,000 - 123,456 = 376,544 / 7일 = 53,792 -> 53,700
    var b2 = budget({ id: "b2", startDate: "2026-08-16", endDate: "2026-08-28", totalAmount: 500000 });
    var e2 = [exp("b2", 123456, "2026-08-20")];
    var s2 = calc.computeBudgetStats(b2, e2, "2026-08-22");
    eq("나머지: 남은 금액 376,544", s2.remaining, 376544);
    eq("나머지: 남은 일수 7", s2.daysLeft, 7);
    eq("나머지: 권장액 53,700", s2.perDay, 53700);
    eq("나머지: 오늘 쓴 돈 0", s2.todaySpent, 0);

    /* ---------- 6. 초과 지출: 음수 그대로 ---------- */
    // 100,000 - 150,001 = -50,001 / 5일 = -10,000.2 -> 100원 내림 -> -10,100
    var b3 = budget({ id: "b3", startDate: "2026-08-01", endDate: "2026-08-26", totalAmount: 100000 });
    var e3 = [exp("b3", 150001, "2026-08-10")];
    var s3 = calc.computeBudgetStats(b3, e3, "2026-08-22");
    eq("초과: 남은 금액 음수 그대로", s3.remaining, -50001);
    eq("초과: 남은 일수 5", s3.daysLeft, 5);
    eq("초과: 권장액도 음수", s3.perDay, -10100);
    eq("초과: 게이지는 100%에서 멈춤", s3.spentPct, 100);

    /* ---------- 7. 기간 종료 ---------- */
    var s4 = calc.computeBudgetStats(b, e1, "2026-09-01");
    eq("종료: ended = true", s4.ended, true);
    eq("종료: 권장액 숨김(null)", s4.perDay, null);
    eq("종료: 남은 일수 0", s4.daysLeft, 0);
    eq("종료: 남은 금액은 그대로 계산", s4.remaining, 734300);
    eq("종료: 오늘 쓴 돈 0", s4.todaySpent, 0);

    /* ---------- 8. 마지막 날 ---------- */
    var s5 = calc.computeBudgetStats(b, e1, "2026-08-31");
    eq("마지막날: 남은 일수 1", s5.daysLeft, 1);
    eq("마지막날: 권장액 = 남은 금액 내림 734,300", s5.perDay, 734300);

    /* ---------- 9. 다른 예산 지출은 섞이지 않는다 ---------- */
    var mixed = e1.concat([exp("b_other", 999999, "2026-08-22")]);
    var s6 = calc.computeBudgetStats(b, mixed, "2026-08-22");
    eq("격리: 다른 예산 지출 제외", s6.spent, 65700);

    /* ---------- 10. 지출 0건 ---------- */
    var s7 = calc.computeBudgetStats(b, [], "2026-08-22");
    eq("빈 예산: 남은 금액 = 총액", s7.remaining, 800000);
    eq("빈 예산: 권장액 80,000", s7.perDay, 80000);
    eq("빈 예산: 게이지 0%", s7.spentPct, 0);

    /* ---------- 11. 아주 큰 금액 ---------- */
    var bBig = budget({ id: "bg", startDate: "2026-08-01", endDate: "2026-08-31", totalAmount: 999999999 });
    var sBig = calc.computeBudgetStats(bBig, [exp("bg", 999999999, "2026-08-22")], "2026-08-22");
    eq("큰 금액: 남은 금액 0", sBig.remaining, 0);
    eq("큰 금액: 권장액 0", sBig.perDay, 0);
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

    /* ---------- 20. 자정 넘김 ---------- */
    var beforeMidnight = calc.computeBudgetStats(b, e1, "2026-08-22");
    var afterMidnight = calc.computeBudgetStats(b, e1, "2026-08-23");
    eq("자정: 남은 일수 하루 줄어듦", beforeMidnight.daysLeft - afterMidnight.daysLeft, 1);
    eq("자정: 오늘 쓴 돈 0으로 리셋", afterMidnight.todaySpent, 0);
    eq("자정: 남은 금액은 그대로", afterMidnight.remaining, beforeMidnight.remaining);
    ok("자정: 권장액 늘어남", afterMidnight.perDay > beforeMidnight.perDay);

    return results;
  }

  return {
    run: run,
    get results() {
      return results;
    }
  };
});
