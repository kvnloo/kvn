import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { retrieve, keywords } from "../worker/search.js";
import worker from "../worker/index.js";

const chunks = [
  { id: "1", path: "TOOLS.md", title: "warp", text: "A fast Tizen Plex front end, built for Samsung TVs.", type: "distillation", url: "https://github.com/kvnloo/warp" },
  { id: "2", path: "OPINIONS.md", title: "Verification", text: "Public agent systems need proof instead of invented authority.", type: "distillation", url: "https://github.com/kvnloo/kvn" }
];

test("retrieval is focused on relevant source snippets", () => {
  assert.deepEqual(keywords("What does Kevin think about verification?"), ["think", "verification"]);
  assert.equal(retrieve("Tell me about warp Tizen", chunks, 1)[0].title, "warp");
  assert.equal(retrieve("What does he think about verification?", chunks, 1)[0].title, "Verification");
  assert.deepEqual(retrieve("underwater origami", chunks), []);
});

test("site index only uses manifest-verified public files, deterministically", () => {
  execFileSync(process.execPath, ["scripts/build-site-index.mjs"]);
  const first = readFileSync("site/knowledge.json", "utf8");
  execFileSync(process.execPath, ["scripts/build-site-index.mjs"]);
  const second = readFileSync("site/knowledge.json", "utf8");
  assert.equal(first, second);
  const indexed = JSON.parse(first);
  assert.ok(indexed.chunks.length >= 10);
  assert.ok(indexed.chunks.every((source) => /^https:\/\//.test(source.url)));
  assert.ok(indexed.chunks.some((source) => source.path === "TOOLS.md"));
  assert.ok(indexed.chunks.some((source) => source.path.startsWith("content/")));
});

function makeEnv({ limited = false } = {}) {
  return {
    ASSETS: { fetch: async () => Response.json({ chunks }) },
    RATE_LIMIT: { limit: async () => ({ success: !limited }) },
    AI: { run: async () => ({ response: "warp is a Tizen front end [1]." }) }
  };
}
function post(data, headers = {}) {
  return new Request("https://kvn.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://kvn.test", ...headers },
    body: JSON.stringify(data)
  });
}

test("free chat retrieves evidence and supplies model answer", async () => {
  const result = await worker.fetch(post({ question: "Tell me about warp Tizen" }), makeEnv());
  assert.equal(result.status, 200);
  const json = await result.json();
  assert.equal(json.model, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.match(json.answer, /warp/);
  assert.equal(json.sources[0].url, chunks[0].url);
});

test("unsupported claims do not spend free inference", async () => {
  const env = makeEnv();
  env.AI.run = () => { throw new Error("should not call AI"); };
  const result = await worker.fetch(post({ question: "underwater origami" }), env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).model, "evidence-only");
});

test("rate limiting blocks anonymous abuse", async () => {
  const result = await worker.fetch(post({ question: "warp Tizen" }), makeEnv({ limited: true }));
  assert.equal(result.status, 429);
});

test("cross-origin and bad input fail closed", async () => {
  const origin = await worker.fetch(post({ question: "warp Tizen" }, { origin: "https://evil.invalid" }), makeEnv());
  assert.equal(origin.status, 403);
  const tooLong = await worker.fetch(post({ question: "x".repeat(701) }), makeEnv());
  assert.equal(tooLong.status, 400);
  const unsupported = await worker.fetch(post({ question: "warp", provider: "custom" }), makeEnv());
  assert.equal(unsupported.status, 400);
});
