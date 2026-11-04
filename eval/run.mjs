#!/usr/bin/env node
// /kvn answer-quality eval. Runs every question through the REAL worker (retrieval, prompt,
// inference call, answer parsing) and the REAL browser SSE parser, then grades the answers.
//
//   node eval/run.mjs --model @cf/qwen/qwen3-30b-a3b-fp8 [--stream] [--judge] [--only id,id] [--tag name]
//
// Model routing (the worker's AI binding is replaced by an adapter):
//   @cf/...            Workers AI through EVAL_CF_PROXY (+ EVAL_CF_KEY): a tiny Worker that
//                      forwards {model, input} to env.AI.run; see eval/README.md
//   groq:<id>          GROQ_API_KEY        cerebras:<id>   CEREBRAS_API_KEY
//   nvidia:<id>        NVIDIA_API_KEY      openrouter:<id> OPENROUTER_API_KEY
// Judge (--judge): EVAL_JUDGE (default nvidia:nvidia/nemotron-3-ultra-550b-a55b).
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/index.js";
import { parseChatResponse } from "../site/sse.js";
import { openaiCompat, realFetch, runModel, usage } from "./adapter.mjs";
import { planLocal, NO_EVIDENCE } from "../site/local-llm.js";
import { autoCite } from "../worker/search.js";
import { normalizeCitations } from "../worker/inference.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const opt = (name, fallback) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : fallback; };
const MODEL = opt("model", "@cf/qwen/qwen3-30b-a3b-fp8");
const STREAM = flag("stream");
// --local: the in-browser path (site/local-llm.js retrieval + compact prompt), model via ollama:<id>.
const LOCAL = flag("local");
// --byo groq|openrouter: the visitor bring-your-own-key path through the real Worker, with
// --model naming the provider model (e.g. groq:openai/gpt-oss-120b, openrouter:openrouter/free).
const BYO = opt("byo", "");
const JUDGE = flag("judge") ? opt("judge-model", process.env.EVAL_JUDGE || "nvidia:nvidia/nemotron-3-ultra-550b-a55b") : null;
const ONLY = opt("only", "") ? new Set(opt("only", "").split(",")) : null;
const TAG = opt("tag", (LOCAL ? "local-" : BYO ? "byo-" : "") + MODEL.replace(/[^a-z0-9.-]+/gi, "_") + (STREAM ? "-stream" : ""));
const CONCURRENCY = Number(opt("concurrency", "3"));
const OUT = join(root, "eval", "results");

// Record the exact sources the worker gave the model, keyed by the question, for the judge.
const seenEvidence = new Map();
const AI = {
  run: (model, input) => {
    const system = input.messages?.find((m) => m.role === "system")?.content || "";
    const question = String(input.messages?.at(-1)?.content || "").replace(/ \/no_think$/, "").replace(/^[\s\S]*\nVisitor:\n/, "");
    seenEvidence.set(question, system.split("PUBLIC SOURCES:\n")[1] || system);
    return runModel(model, input);
  }
};

const knowledge = readFileSync(join(root, "site/knowledge.json"), "utf8");
const env = {
  AI,
  FREE_MODEL: MODEL,
  TURNSTILE_SITE_KEY: "eval-site",
  TURNSTILE_SECRET: "eval-secret",
  ASSETS: { fetch: async (req) => new URL(req.url).pathname === "/knowledge.json" ? new Response(knowledge, { headers: { "content-type": "application/json" } }) : new Response("not found", { status: 404 }) }
};
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("challenges.cloudflare.com/turnstile")) return Response.json({ success: true, hostname: "kvn.eval" });
  if (BYO && /groq\.com|openrouter\.ai/.test(url) && init?.body) {
    const sent = JSON.parse(init.body);
    const system = sent.messages?.find((m) => m.role === "system")?.content || "";
    const question = String(sent.messages?.at(-1)?.content || "").replace(/^[\s\S]*\nVisitor:\n/, "");
    seenEvidence.set(question, system.split("PUBLIC SOURCES:\n")[1] || system);
    const res = await realFetch(input, init);
    if (res.ok) { const json = await res.clone().json(); usage.push({ model: MODEL, ...(json.usage || {}) }); }
    return res;
  }
  return realFetch(input, init);
};

const localCorpus = JSON.parse(knowledge).chunks;
async function askLocal(item) {
  const t0 = Date.now();
  const { hits, messages } = planLocal(item.q, item.history || [], localCorpus, MODEL);
  const sources = hits.map((doc) => ({ title: doc.title, url: doc.url, type: doc.type }));
  if (!messages) return { ok: true, answer: NO_EVIDENCE, sources: [], model: "evidence-only", ms: 0 };
  seenEvidence.set(item.q, messages[0].content.split("PUBLIC SOURCES:\n")[1] || messages[0].content);
  try {
    const out = await openaiCompat(MODEL, { messages, temperature: 0.35, max_tokens: 500 });
    const raw = String(out.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const answer = flag("no-autocite") ? raw : autoCite(raw, hits);
    return { ok: Boolean(answer), answer, sources, model: MODEL, ms: Date.now() - t0, error: answer ? undefined : "empty" };
  } catch (error) {
    return { ok: false, error: error.message, ms: Date.now() - t0 };
  }
}

async function ask(item) {
  if (LOCAL) return askLocal(item);
  const request = new Request("https://kvn.eval/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://kvn.eval", "cf-connecting-ip": "203.0.113." + Math.floor(Math.random() * 200) },
    body: JSON.stringify({ question: item.q, history: item.history || [], provider: BYO || "cloudflare", turnstileToken: "eval", stream: STREAM,
      ...(BYO ? { apiKey: process.env[BYO === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY"], model: MODEL.replace(/^[a-z]+:/, "") } : {}) })
  });
  const t0 = Date.now();
  const response = await worker.fetch(request, env);
  let firstToken = null;
  try {
    const data = await parseChatResponse(response, ({ answer }) => { if (answer && firstToken === null) firstToken = Date.now() - t0; });
    return { ok: true, answer: data.answer, sources: data.sources || [], model: data.model, ms: Date.now() - t0, firstTokenMs: firstToken };
  } catch (error) {
    return { ok: false, error: error.message, ms: Date.now() - t0, status: response.status };
  }
}

function deterministic(item, result) {
  const problems = [];
  if (!result.ok) return ["error: " + result.error];
  const a = normalizeCitations(result.answer);
  const lower = a.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (/<\/?think>|<\|[a-z]+\|>|^analysis\b|assistant\s*final/i.test(a)) problems.push("reasoning leaked");
  const cites = [...a.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const n = result.sources.length;
  if (cites.some((c) => c < 1 || c > n)) problems.push("citation out of range (" + n + " sources)");
  if (["tools", "opinion", "contrib", "voice"].includes(item.kind) && n > 0 && !cites.length) problems.push("no citations");
  for (const group of item.any || []) if (!group.some((term) => lower.includes(term))) problems.push("missing any of: " + group.join(" | "));
  for (const pattern of item.none || []) if (new RegExp(pattern, "im").test(a)) problems.push("forbidden: " + pattern);
  if (a.length > 2200) problems.push("too long (" + a.length + " chars)");
  if (/\u2026$|[a-z,]$/i.test(a.trim()) && !/(https?:\/\/|`)\S*$/.test(a.trim()) && a.length > 300) problems.push("looks truncated");
  return problems;
}

async function judge(item, result, evidence) {
  if (!JUDGE || !result.ok) return null;
  const prompt = [
    "You are a strict grader for /kvn, a public AI that answers questions about Kevin Rajan ONLY from numbered public sources. Rules for /kvn: never pretend to be Kevin; cite sources as [n] next to claims about Kevin; say plainly when the sources don't cover something; never invent facts, numbers, employers, beliefs or private details; be concise and direct. Statements about /kvn itself (that it is an AI guide to Kevin's public work, not Kevin, and what it covers) come from its rules, need no source, and are not claims about Kevin.",
    "QUESTION: " + item.q,
    item.history?.length ? "PRIOR TURNS: " + JSON.stringify(item.history) : "",
    "WHAT A GREAT ANSWER DOES (owner's note): " + item.expect,
    "SOURCES /kvn WAS GIVEN:\n" + evidence,
    "ANSWER TO GRADE:\n" + result.answer,
    "Step 1: list every factual claim the answer makes about Kevin or his work, and for each decide whether the sources above support it (true/false) and whether its [n] marker points at a source that supports it (true/false/missing).",
    "Step 2: score. Be harsh: a 2 means a careful human expert with the same sources could not do meaningfully better on that axis.",
    "grounded: 2 = every claim supported; 1 = one minor unsupported detail or embellishment; 0 = an invented fact, number or attribution.",
    "citations: 2 = every Kevin claim has a correct [n]; 1 = some missing or pointing at the wrong source; 0 = mostly missing/wrong. If the answer correctly makes no claims about Kevin, give 2.",
    "helpful: 2 = directly answers using the most relevant available evidence, with links or next steps where useful; 1 = correct but vague, incomplete, or misses key information that the sources contain; 0 = unhelpful or wrong.",
    "behavior: 2 = matches the owner's note; 1 = partly; 0 = violates it (e.g. role-plays Kevin, accepts a false premise, leaks or guesses private info).",
    "style: 2 = concise, natural, leads with the answer, no filler, no needless hedging or closing offers; 1 = wordy, robotic or padded; 0 = hard to read.",
    "Return ONLY JSON: {\"claims\":[{\"claim\":\"...\",\"supported\":true,\"cited\":true}],\"grounded\":0,\"citations\":0,\"helpful\":0,\"behavior\":0,\"style\":0,\"issue\":\"the biggest problem in one short sentence, or none\"}"
  ].filter(Boolean).join("\n\n");
  const out = await openaiCompat(JUDGE, { messages: [{ role: "user", content: prompt }], max_tokens: 4000, temperature: 0 });
  const text = out.choices?.[0]?.message?.content || "";
  const match = text.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/);
  try { return JSON.parse(match[0]); } catch { return { parseError: text.slice(0, 200) }; }
}

function evidenceFor(item) {
  return seenEvidence.get(item.q) || "(no sources: the worker answered without calling the model)";
}

// --regrade <tag>: judge only the rows of an earlier run whose grade is missing or failed.
if (opt("regrade", "")) {
  const path = join(OUT, opt("regrade") + ".jsonl");
  const items = new Map(JSON.parse(readFileSync(join(root, "eval/questions.json"), "utf8")).map((q) => [q.id, q]));
  const rows = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  for (const row of rows) {
    const force = opt("ids", "").split(",").includes(row.id);
    if (!force && row.grade && typeof row.grade.grounded === "number") continue;
    if (!row.evidence) { console.log("skip " + row.id + ": no saved evidence"); continue; }
    try { row.grade = await judge(items.get(row.id), row, row.evidence); } catch (e) { row.grade = { judgeError: e.message }; }
    console.log(row.id + " " + JSON.stringify(row.grade).slice(0, 120));
  }
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  process.exit(0);
}

const questions = JSON.parse(readFileSync(join(root, "eval/questions.json"), "utf8")).filter((q) => !ONLY || ONLY.has(q.id));
mkdirSync(OUT, { recursive: true });
const file = join(OUT, TAG + ".jsonl");
writeFileSync(file, "");
const rows = [];
let next = 0;
async function lane() {
  while (next < questions.length) {
    const item = questions[next++];
    const result = await ask(item);
    const problems = deterministic(item, result);
    let grade = null;
    try { grade = await judge(item, result, evidenceFor(item)); } catch (e) { grade = { judgeError: e.message }; }
    const row = { id: item.id, kind: item.kind, q: item.q, ...result, problems, grade, evidence: evidenceFor(item) };
    rows.push(row);
    // A dead endpoint (expired proxy, exhausted quota) fails every question; stop early.
    if (rows.length >= 6 && rows.every((r) => !r.ok)) { console.error("every request failed: " + row.error); process.exit(2); }
    appendFileSync(file, JSON.stringify(row) + "\n");
    const g = grade && !grade.parseError && !grade.judgeError ? ["grounded", "citations", "helpful", "behavior", "style"].map((k) => grade[k]).join("") : "-";
    console.log((problems.length ? "✗" : "✓") + " " + item.id.padEnd(14) + " " + String(result.ms).padStart(6) + "ms judge=" + g + " " + (problems.join("; ") || "") + (grade?.issue && grade.issue !== "none" ? " | " + grade.issue : ""));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, lane));

const ok = rows.filter((r) => r.ok);
const graded = rows.filter((r) => r.grade && typeof r.grade.grounded === "number");
const mean = (k) => graded.length ? (graded.reduce((s, r) => s + r.grade[k], 0) / graded.length).toFixed(2) : "-";
const sum = (arr, k) => arr.reduce((s, u) => s + (Number(u[k]) || 0), 0);
const summary = {
  tag: TAG, model: MODEL, stream: STREAM, questions: rows.length,
  answered: ok.length, deterministicPass: rows.filter((r) => !r.problems.length).length,
  judge: JUDGE, grounded: mean("grounded"), citations: mean("citations"), helpful: mean("helpful"), behavior: mean("behavior"), style: mean("style"),
  judgeTotal: graded.length ? (graded.reduce((s, r) => s + r.grade.grounded + r.grade.citations + r.grade.helpful + r.grade.behavior + r.grade.style, 0) / graded.length).toFixed(2) + "/10" : "-",
  p50ms: ok.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] || null,
  neuronsPerAnswer: usage.some((u) => u.neurons) ? (sum(usage.filter((u) => u.model === MODEL), "neurons") / Math.max(1, ok.length)).toFixed(1) : null,
  completionTokensPerAnswer: (sum(usage.filter((u) => u.model === MODEL), "completion_tokens") / Math.max(1, ok.length)).toFixed(0)
};
appendFileSync(join(OUT, "summary.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...summary }) + "\n");
console.log(JSON.stringify(summary, null, 1));
