import { parseChatResponse } from "../site/sse.js";
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

test("free chat retrieves evidence and supplies model answer", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, hostname: "kvn.test" }));
  const env = { ...makeEnv(), TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "test-secret" };
  const result = await worker.fetch(post({ question: "Tell me about warp Tizen", turnstileToken: "validated-token" }), env);
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

test("free inference fails closed without Turnstile bindings", async () => {
  const result = await worker.fetch(post({ question: "Tell me about warp Tizen" }), makeEnv());
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /Turnstile/);
});

test("Turnstile validates hostname and single-use token", async (t) => {
  const env = { ...makeEnv(), TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "test-secret" };
  const missing = await worker.fetch(post({ question: "warp Tizen" }), env);
  assert.equal(missing.status, 403);
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, hostname: "different.example" }));
  const mismatch = await worker.fetch(post({ question: "warp Tizen", turnstileToken: "token" }), env);
  assert.equal(mismatch.status, 403);
});

test("status exposes configuration but never a secret", async () => {
  const response = await worker.fetch(new Request("https://kvn.test/api/status"), makeEnv());
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.freeConfigured, false);
  assert.ok(!("TURNSTILE_SECRET" in status));
});

test("streaming parser survives split UTF-8/SSE chunks and retains evidence", async () => {
  const encoder = new TextEncoder();
  const raw = 'event: sources\ndata: {"sources":[{"title":"warp","url":"https://github.com/kvnloo/warp"}],"model":"qwen"}\n\n' +
    'data: {"response":"warp"}\n\n' + 'data: {"response":" works"}\n\n' + 'data: [DONE]\n\n';
  const bytes = encoder.encode(raw);
  const chunks = [bytes.slice(0, 7), bytes.slice(7, 53), bytes.slice(53, 101), bytes.slice(101)];
  const response = new Response(new ReadableStream({
    start(controller) { for (const item of chunks) controller.enqueue(item); controller.close(); }
  }), { headers: { "content-type": "text/event-stream" } });
  const updates = [];
  const result = await parseChatResponse(response, (x) => updates.push(x));
  assert.equal(result.answer, "warp works");
  assert.equal(result.sources[0].title, "warp");
  assert.ok(updates.length >= 2);
});

test("worker streams sourced Cloudflare response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, hostname: "kvn.test" }));
  const env = { ...makeEnv(), TURNSTILE_SITE_KEY: "test-site", TURNSTILE_SECRET: "test-secret" };
  env.AI.run = async (_model, options) => {
    assert.equal(options.stream, true);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response":"warp works [1]"}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
  };
  const response = await worker.fetch(post({
    question: "warp Tizen", turnstileToken: "valid-test-token", stream: true
  }), env);
  assert.equal(response.status, 200);
  const output = await parseChatResponse(response);
  assert.match(output.answer, /warp/);
  assert.equal(output.sources[0].url, chunks[0].url);
});
