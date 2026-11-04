#!/usr/bin/env node
// Compare eval runs from their per-question rows: node eval/report.mjs <tag> [tag ...]
// (no tags = every run in eval/results). Judge means use graded rows only; "graded" says how many.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeRows } from "./aggregate.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
const tags = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f !== "summary.jsonl").map((f) => f.slice(0, -6));
const summaries = new Map(readFileSync(join(dir, "summary.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((s) => [s.tag, s]));

const table = tags.map((tag) => {
  const rows = readFileSync(join(dir, tag + ".jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    tag,
    ...summarizeRows(rows),
    judge: summaries.get(tag)?.judge ?? "unknown",
    neurons: summaries.get(tag)?.neuronsPerAnswer ?? null
  };
}).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
console.table(table);
