#!/usr/bin/env node
// Local dev server for the real site + Worker, with free-tier inference and no Cloudflare login.
// Static files come from site/, /api/* goes through worker/index.js, and the Worker's AI
// binding is routed by eval/adapter.mjs. Turnstile uses Cloudflare's public always-pass test
// sitekey, and siteverify is mocked.
//
//   node eval/serve.mjs [--port 8787] [--model @cf/qwen/qwen3-30b-a3b-fp8]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../worker/index.js";
import { mockTurnstile, runModel } from "./adapter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : fallback; };
const PORT = Number(opt("port", "8787"));
const MODEL = opt("model", "@cf/qwen/qwen3-30b-a3b-fp8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

async function asset(request) {
  let path = decodeURIComponent(new URL(request.url).pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, "site", path));
  if (!file.startsWith(join(root, "site"))) return new Response("forbidden", { status: 403 });
  try {
    return new Response(await readFile(file), { headers: { "content-type": TYPES[extname(file)] || "application/octet-stream" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

mockTurnstile("localhost");
const env = {
  AI: { run: runModel },
  FREE_MODEL: MODEL,
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET: "local-test-secret",
  ASSETS: { fetch: asset }
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const url = "http://localhost:" + PORT + req.url;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
  headers.set("cf-connecting-ip", req.socket.remoteAddress || "127.0.0.1");
  const request = new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  try {
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(error?.stack || error));
  }
}).listen(PORT, () => console.log("kvn dev server on http://localhost:" + PORT + " · model " + MODEL));
