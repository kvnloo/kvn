import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRows, AXES } from "../eval/aggregate.mjs";
const grade = Object.fromEntries(AXES.map((axis) => [axis, 2]));

test("only complete in-range grades on successful transports contribute", () => {
  const rows = [
    { id: "good", ok: true, grade, problems: [], ms: 20 },
    { id: "partial", ok: true, grade: { grounded: 2 }, problems: [], ms: 10 },
    { id: "failed", ok: false, grade, ms: 0 },
    { id: "range", ok: true, grade: { ...grade, style: 3 }, problems: ["bad"] },
    { id: "string", ok: true, grade: { ...grade, style: "2" } }
  ];
  const result = summarizeRows(rows);
  assert.equal(result.questions, 5);
  assert.equal(result.answered, 4);
  assert.equal(result.graded, 1);
  assert.equal(result.ungraded, 4);
  assert.equal(result.score, 10);
  assert.equal(result.clean, 2);
  assert.equal(result.p50ms, 20);
});

test("ungraded or empty results have no score and missing checks are not clean", () => {
  const result = summarizeRows([{ ok: true }]);
  assert.equal(result.score, null);
  assert.equal(result.clean, 0);
  assert.equal(result.p50ms, null);
  assert.equal(summarizeRows([]).score, null);
});
