#!/usr/bin/env node
// Remote read-only smoke checks; do not spend Workers AI inference quota.
import assert from "node:assert/strict";

const target = process.argv[2];
if (!target || !/^https:\/\//.test(target)) {
  console.error("Usage: npm run smoke:site -- https://actual-site.workers.dev");
  process.exit(2);
}
const base = new URL(target);
if (base.username || base.password || base.search || base.hash) {
  console.error("Specify only a public HTTPS site origin, no secrets or query.");
  process.exit(2);
}
const endpoint = (path) => new URL(path, base.origin);
async function request(path, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(endpoint(path), { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function run(label, fn) {
  try {
    await fn();
    console.log("PASS " + label);
  } catch (error) {
    console.error("FAIL " + label + ": " + error.message);
    process.exitCode = 1;
  }
}
await run("homepage", async () => {
  const r = await request("/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>\/kvn/);
});
await run("status and protected-free configuration", async () => {
  const r = await request("/api/status");
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.defaultModel, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(data.freeConfigured, true, "AI + Turnstile missing");
  assert.ok(data.turnstileSiteKey);
});
await run("public evidence index", async () => {
  const r = await request("/knowledge.json");
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.schemaVersion, 1);
  assert.ok(Array.isArray(data.chunks) && data.chunks.length >= 10);
  assert.ok(data.chunks.every((chunk) => String(chunk.url).startsWith("https://")));
});
await run("GET chat rejected", async () => {
  assert.equal((await request("/api/chat")).status, 405);
});
await run("bad question rejected without inference", async () => {
  const r = await request("/api/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: " " })
  });
  assert.equal(r.status, 400);
});
await run("cross-origin request rejected", async () => {
  const r = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://untrusted.invalid" },
    body: JSON.stringify({ question: "What has Kevin built?" })
  });
  assert.equal(r.status, 403);
});
if (!process.exitCode) {
  console.log("Smoke checks passed. Verify real Turnstile + chat in a browser.");
}
