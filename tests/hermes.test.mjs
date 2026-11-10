// "Your Hermes" provider, end to end: page code -> real bridge -> a scripted ACP agent.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askHermes, connectHermes, hermesPrompt, parsePairing } from "../site/hermes.js";

const chunk = { id: "c1", title: "garden-room", url: "https://github.com/kvnloo/garden-room", type: "repo",
  text: "Kevin built garden-room, a WebXR garden planner with voice control." };

test("pairing accepts the printed code and the #acp= link, rejects junk", () => {
  const token = "Ab3_" + "x".repeat(20);
  assert.deepEqual(parsePairing(`43190.${token}`), { port: 43190, token });
  assert.deepEqual(parsePairing(`https://kvn.example/#acp=43190.${token}`), { port: 43190, token });
  assert.equal(parsePairing("43190.short"), null);
  assert.equal(parsePairing("hello"), null);
});

test("the prompt carries the public evidence and forbids tools", () => {
  const prompt = hermesPrompt("What did Kevin build?", [], [chunk]);
  assert.match(prompt, /garden-room/);
  assert.match(prompt, /What did Kevin build\?/);
  assert.match(prompt, /do not run tools/);
});

test("askHermes streams the agent's answer with the same citations as other providers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kvn-hermes-"));
  const agent = path.join(dir, "agent.mjs");
  fs.writeFileSync(agent, `
let buf = '';
const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.method === 'initialize') out({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'hermes', title: 'Hermes', version: '9.9' } } });
  if (m.method === 'session/new') out({ id: m.id, result: { sessionId: 's1' } });
  if (m.method === 'session/prompt') {
    const sawEvidence = m.params.prompt[0].text.includes('WebXR garden planner');
    for (const text of ['Kevin built ', sawEvidence ? 'garden-room [1].' : 'nothing.'])
      out({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    out({ id: m.id, result: { stopReason: 'end_turn' } });
  } } });`);
  const port = 43000 + Math.floor(Math.random() * 900), token = "e2e" + "y".repeat(20), origin = "http://127.0.0.1:43172";
  const bridge = spawn("node", [new URL("../site/acp/bridge.mjs", import.meta.url).pathname, "--port", String(port),
    "--origin", origin, "--cmd", `node ${agent}`, "--log", path.join(dir, "bridge.log")],
    { env: { ...process.env, KVN_BRIDGE_TOKEN: token }, stdio: "ignore" });
  const realFetch = globalThis.fetch;
  const corpus = JSON.parse(fs.readFileSync(new URL("../site/knowledge.json", import.meta.url), "utf8")).chunks;
  globalThis.fetch = async (url) => ({ ok: String(url) === "/knowledge.json", json: async () => ({ chunks: [chunk, ...corpus] }) });
  class PageSocket extends WebSocket { constructor(url, protocols) { super(url, { protocols, headers: { origin } }); } }
  try {
    await new Promise((r) => setTimeout(r, 500));
    const info = await connectHermes({ ...parsePairing(`${port}.${token}`), WebSocketImpl: PageSocket }, () => assert.fail("no tools expected"));
    assert.equal(info.agent.title, "Hermes");
    const seen = [];
    const result = await askHermes("Tell me about garden-room, the WebXR garden planner", [], (answer) => seen.push(answer));
    assert.equal(result.answer, "Kevin built garden-room [1].");
    assert.deepEqual(seen, ["Kevin built ", "Kevin built garden-room [1]."]);
    assert.equal(result.sources[0].url, chunk.url);
    assert.match(result.model, /Hermes · your machine/);
  } finally {
    globalThis.fetch = realFetch;
    bridge.kill("SIGINT");
  }
});
