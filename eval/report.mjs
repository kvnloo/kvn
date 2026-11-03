#!/usr/bin/env node
// Compare eval runs from their per-question rows: node eval/report.mjs <tag> [tag ...]
// (no tags = every run in eval/results). Judge means use graded rows only; "graded" says how many.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
const tags = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f !== "summary.jsonl").map((f) => f.slice(0, -6));
const summaries = new Map(readFileSync(join(dir, "summary.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((s) => [s.tag, s]));
const AXES = ["grounded", "citations", "helpful", "behavior", "style"];

const table = tags.map((tag) => {
  const rows = readFileSync(join(dir, tag + ".jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const graded = rows.filter((r) => typeof r.grade?.grounded === "number");
  const total = (r) => AXES.reduce((s, k) => s + r.grade[k], 0);
  const ms = rows.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  return {
    tag,
    questions: rows.length,
    clean: rows.filter((r) => !r.problems?.length).length,
    graded: graded.length,
    score: graded.length ? +(graded.reduce((s, r) => s + total(r), 0) / graded.length).toFixed(2) : null,
    perfect: graded.filter((r) => total(r) === 10).length,
    worst: graded.filter((r) => total(r) <= 6).map((r) => r.id).join(" ") || "-",
    p50ms: ms[Math.floor(ms.length / 2)] ?? null,
    neurons: summaries.get(tag)?.neuronsPerAnswer ?? null
  };
}).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
console.table(table);
