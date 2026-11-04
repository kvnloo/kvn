// Pure aggregation: malformed/partial grades and failed transports cannot count as passes.
export const AXES = ["grounded", "citations", "helpful", "behavior", "style"];
export function summarizeRows(rows) {
  const validGrade = (r) => r.ok === true && AXES.every((axis) =>
    Number.isFinite(r.grade?.[axis]) && r.grade[axis] >= 0 && r.grade[axis] <= 2);
  const graded = rows.filter(validGrade);
  const total = (r) => AXES.reduce((sum, axis) => sum + r.grade[axis], 0);
  const times = rows.filter((r) => r.ok === true && Number.isFinite(r.ms) && r.ms >= 0)
    .map((r) => r.ms).sort((a, b) => a - b);
  return {
    questions: rows.length,
    answered: rows.filter((r) => r.ok === true).length,
    clean: rows.filter((r) => r.ok === true && Array.isArray(r.problems) && !r.problems.length).length,
    graded: graded.length,
    ungraded: rows.length - graded.length,
    score: graded.length ? +(graded.reduce((sum, r) => sum + total(r), 0) / graded.length).toFixed(2) : null,
    perfect: graded.filter((r) => total(r) === 10).length,
    worst: graded.filter((r) => total(r) <= 6).map((r) => r.id).join(" ") || "-",
    p50ms: times[Math.floor(times.length / 2)] ?? null
  };
}
