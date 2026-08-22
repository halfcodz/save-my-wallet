/* node js/run-tests.node.js — 브라우저 없이 계산 함수만 빠르게 검증 */
globalThis.localStorage = (function () {
  var m = {};
  return {
    getItem: function (k) { return k in m ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
})();

var tests = require("./tests.js");
var results = tests.run();
var failed = results.filter(function (r) { return !r.ok; });

results.forEach(function (r) {
  if (!r.ok) console.log("  FAIL  " + r.name + "\n        got " + r.actual + " / want " + r.expected);
});
console.log("\n" + (results.length - failed.length) + " / " + results.length + " passed");
process.exit(failed.length ? 1 : 0);
