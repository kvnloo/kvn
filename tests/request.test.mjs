import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker/index.js";

function request(body, headers = {}) {
  return new Request("https://kvn.test/api/chat", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body, duplex: "half"
  });
}
const noSideEffects = {
  ASSETS: { fetch() { assert.fail("rejected input must not retrieve assets"); } },
  AI: { run() { assert.fail("rejected input must not invoke inference"); } }
};

test("chunked oversized body stops reading and cancels before side effects", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(12001)); },
    cancel() { cancelled = true; }
  });
  const result = await worker.fetch(request(body), noSideEffects);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
});

test("UTF-8 byte limit is not a JavaScript character limit", async () => {
  const body = JSON.stringify({ question: "warp", padding: "🦆".repeat(4000) });
  assert.ok(body.length < 12000);
  assert.equal((await worker.fetch(request(body), noSideEffects)).status, 413);
});

test("declared oversized, malformed JSON and invalid UTF-8 are rejected", async () => {
  assert.equal((await worker.fetch(request("{}", { "content-length": "12001" }), noSideEffects)).status, 413);
  assert.equal((await worker.fetch(request("{"), noSideEffects)).status, 400);
  assert.equal((await worker.fetch(request(new Uint8Array([0xff])), noSideEffects)).status, 400);
});

test("valid JSON may split a multibyte character between transport chunks", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ question: "🦆" }));
  const body = new ReadableStream({ start(c) {
    for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
    c.close();
  } });
  let limited = false;
  const env = { RATE_LIMIT: { async limit() { limited = true; return { success: false }; } } };
  assert.equal((await worker.fetch(request(body), env)).status, 429);
  assert.equal(limited, true);
});
