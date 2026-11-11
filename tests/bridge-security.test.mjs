import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { AcpClient } from '../site/acp/acp.js';
import { startBridge, origin, token } from './helpers/bridge.mjs';

function upgrade(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/', headers: {
      connection: 'Upgrade', upgrade: 'websocket', origin,
      'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-protocol': `kvn.v1, kvn.${token}`, ...headers
    } });
    req.on('response', response => { response.resume(); resolve(response.statusCode); });
    req.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('unexpected upgrade')); });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('upgrade timed out')));
    req.end();
  });
}

test('bridge rejects unapproved origins, bad tokens, DNS-rebinding hosts and concurrent pages', { timeout: 10000 }, async t => {
  const bridge = await startBridge(t);
  assert.equal(await upgrade(bridge.port, { origin: 'https://unapproved.invalid' }), 403);
  assert.equal(await upgrade(bridge.port, { origin: '' }), 403);
  assert.equal(await upgrade(bridge.port, { 'sec-websocket-protocol': 'kvn.v1, kvn.wrong-token' }), 401);
  assert.equal(await upgrade(bridge.port, { host: 'rebind.invalid' }), 403);
  const client = new AcpClient(bridge);
  await client.start();
  assert.equal(await upgrade(bridge.port), 409);
  const result = await client.request('session/new', { cwd: '/private', mcpServers: [{ name: 'untrusted', command: 'ignored' }] });
  assert.notEqual(result.received.cwd, '/private');
  assert.match(result.received.cwd, /kvn-acp-/);
  assert.deepEqual(result.received.mcpServers, []);
  client.close();
});

test('permission outcomes cross the bridge only after an explicit choice; page files stay unavailable', { timeout: 15000 }, async t => {
  for (const choice of ['deny', 'allow', 'not-offered', null]) {
    await t.test(String(choice), async t => {
      const bridge = await startBridge(t);
      const client = new AcpClient(bridge);
      await client.start();
      let choose, result;
      client.addEventListener('permission', e => { choose = e.detail.choose; });
      client.addEventListener('update', e => { result = e.detail.result; });
      const prompt = client.prompt('Test permission flow without running a real tool.');
      for (let i = 0; i < 100 && !choose; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(typeof choose, 'function');
      assert.equal(result, undefined, 'no automatic permission response');
      choose(choice);
      const reply = await prompt;
      assert.deepEqual(result.outcome, choice === 'allow' || choice === 'deny' ? { outcome: 'selected', optionId: choice } : { outcome: 'cancelled' });
      assert.equal(reply.fileReply.code, -32601, 'the page refuses filesystem RPC');
      client.close();
    });
  }
});

test('bridge withholds error data and non-JSON diagnostic stdout at the wire boundary', { timeout: 10000 }, async t => {
  const bridge = await startBridge(t, `
process.stdin.once('data', () => {
  process.stdout.write('RAW_PRIVATE_SENTINEL\\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'PRIVATE_SENTINEL', data: { secret: 'DATA_SENTINEL' } } }) + '\\n');
});`);
  const ws = new bridge.WebSocketImpl(`ws://127.0.0.1:${bridge.port}`, ['kvn.v1', `kvn.${bridge.token}`]);
  await once(ws, 'open');
  const messages = [];
  ws.addEventListener('message', e => messages.push(String(e.data)));
  const received = once(ws, 'message');
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  await received;
  assert.deepEqual(JSON.parse(messages[0]).error, { code: -32001, message: 'Agent request failed; see the local bridge log.' });
  assert.ok(!messages.join('').includes('SENTINEL'));
  const log = fs.readFileSync(path.join(bridge.dir, 'bridge.log'), 'utf8');
  assert.match(log, /RAW_PRIVATE_SENTINEL/);
  assert.match(log, /DATA_SENTINEL/);
  ws.close();
});

test('bridge closes oversized page messages and oversized agent output', { timeout: 10000 }, async t => {
  await t.test('page message', async t => {
    const bridge = await startBridge(t);
    const client = new AcpClient(bridge);
    await client.start();
    const closed = once(client, 'close');
    client.ws.send('x'.repeat(1024 * 1024 + 1));
    await closed;
    assert.equal(client.pending.size, 0);
  });
  await t.test('agent output', async t => {
    const bridge = await startBridge(t, `process.stdin.once('data', () => process.stdout.write('x'.repeat(1024 * 1024 + 1)));`);
    const client = new AcpClient(bridge);
    await client.open();
    await assert.rejects(client.request('initialize', {}, 2000), /Connection closed/);
    assert.equal(client.pending.size, 0);
  });
});
