import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpClient } from '../site/acp/acp.js';

function client() {
  const c = new AcpClient({ port: 1, token: 'test' });
  c.ws = { readyState: 1, send() {} };
  return c;
}
test('ACP request timeout rejects and clears pending state', async () => {
  const c = client();
  await assert.rejects(c.request('initialize', {}, 5), /timed out during initialize/);
  assert.equal(c.pending.size, 0);
});
test('ACP errors do not expose arbitrary agent error text', async () => {
  const c = client();
  const pending = c.request('initialize', {}, 100);
  c.onFrame(JSON.stringify({ id: 1, error: { code: -1, message: 'PRIVATE_SENTINEL' } }));
  await assert.rejects(pending, e => !e.message.includes('PRIVATE_SENTINEL') && e.phase === 'initialize');
  assert.equal(c.pending.size, 0);
});
test('ACP refuses requests before connection without retaining pending state', async () => {
  const c = client(); c.ws.readyState = 0;
  await assert.rejects(c.request('initialize', {}), /not connected/);
  assert.equal(c.pending.size, 0);
});
test('ACP permission choices are offered, single-use and tied to the current connection', () => {
  for (const choice of ['allow', 'not-offered', null]) {
    const c = client(), sent = [];
    c.ws.send = value => sent.push(JSON.parse(value));
    let choose;
    c.addEventListener('permission', event => { choose = event.detail.choose; });
    c.onFrame(JSON.stringify({ id: 'permission', method: 'session/request_permission', params: {
      options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }]
    } }));
    assert.deepEqual(sent, [], 'a request must wait for an explicit choice');
    choose(choice);
    choose('allow');
    assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 'permission', result: {
      outcome: choice === 'allow' ? { outcome: 'selected', optionId: 'allow' } : { outcome: 'cancelled' }
    } }], 'unoffered choices cancel and a permission can only be answered once');
  }
  const c = client(), sent = [];
  let choose;
  c.addEventListener('permission', event => { choose = event.detail.choose; });
  c.onFrame(JSON.stringify({ id: 'old', method: 'session/request_permission', params: {
    options: [{ optionId: 'allow', kind: 'allow_once' }]
  } }));
  c.ws = { readyState: 1, send: value => sent.push(JSON.parse(value)) };
  choose('allow');
  assert.deepEqual(sent, [], 'a stale permission must not reach a replacement connection');
});
test('bridge keeps agent stderr and RPC error detail in the local log, never on the page', async () => {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-log-'));
  const agent = path.join(dir, 'agent.mjs'), logFile = path.join(dir, 'bridge.log');
  fs.writeFileSync(agent, `process.stdin.on('data', d => { const m = JSON.parse(String(d).trim()); process.stderr.write('STDERR_SENTINEL\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'RPC_SENTINEL' } }) + '\\n'); });`);
  const port = 43000 + Math.floor(Math.random() * 900), token = 'logtest' + 'x'.repeat(20);
  const bridge = spawn('node', [new URL('../site/acp/bridge.mjs', import.meta.url).pathname, '--port', String(port), '--origin', 'http://127.0.0.1:43172', '--cmd', `node ${agent}`, '--log', logFile], { env: { ...process.env, KVN_BRIDGE_TOKEN: token }, stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 500));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { protocols: ['kvn.v1', `kvn.${token}`], headers: { origin: 'http://127.0.0.1:43172' } });
    const frames = [];
    ws.onmessage = e => frames.push(String(e.data));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await new Promise(r => setTimeout(r, 800));
    ws.close();
    const page = frames.join('\n'), log = fs.readFileSync(logFile, 'utf8');
    assert.ok(!page.includes('STDERR_SENTINEL'), 'stderr must not reach the page');
    assert.ok(!page.includes('RPC_SENTINEL'), 'RPC error detail must not reach the page');
    const error = JSON.parse(frames.find(f => JSON.parse(f).id === 1)).error;
    assert.deepEqual(error, { code: -32000, message: 'Agent request failed; see the local bridge log.' });
    assert.ok(log.includes('STDERR_SENTINEL') && log.includes('RPC_SENTINEL'), 'both land in the local log');
    assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
  } finally { bridge.kill('SIGINT'); }
});
