/* node js/run-tests.node.js — 브라우저 없이 계산·데이터 함수만 빠르게 검증.
   calc.js와 model.js는 DOM도 저장소도 건드리지 않아서 그대로 require된다. */

var tests = require("./tests.js");
var results = tests.run();
var failed = results.filter(function (r) { return !r.ok; });

results.forEach(function (r) {
  if (!r.ok) console.log("  FAIL  " + r.name + "\n        got " + r.actual + " / want " + r.expected);
});
console.log("\n" + (results.length - failed.length) + " / " + results.length + " passed");
process.exit(failed.length ? 1 : 0);
