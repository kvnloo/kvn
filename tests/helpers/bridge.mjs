import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const origin = 'http://127.0.0.1:43172';
export const token = 'test-only-' + 'x'.repeat(24);
export const agentSource = `
import { createInterface } from 'node:readline';
const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
let promptId;
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') out({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'scripted-test-agent' } } });
  else if (m.method === 'session/new') out({ id: m.id, result: { sessionId: 's1', received: m.params } });
  else if (m.method === 'session/prompt') {
    promptId = m.id;
    out({ id: 'permission', method: 'session/request_permission', params: {
      sessionId: 's1', toolCall: { toolCallId: 'tool1', title: 'Test tool', kind: 'read' },
      options: [{ optionId: 'deny', name: 'Deny', kind: 'reject_once' }, { optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
    } });
  } else if (m.id === 'permission') {
    out({ id: 'files', method: 'fs/read_text_file', params: { path: '/must-not-be-read' } });
    out({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'test_permission', result: m.result } } });
  } else if (m.id === 'files') {
    out({ id: promptId, result: { stopReason: 'end_turn', fileReply: m.error } });
  } else if (m.id != null) out({ id: m.id, result: { received: m.params } });
});
`;

export async function startBridge(t, source = agentSource, allowedOrigin = origin) {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvn-bridge-test-'));
  const agent = path.join(dir, 'agent.mjs');
  fs.writeFileSync(agent, source);
  const child = spawn(process.execPath, [new URL('../../site/acp/bridge.mjs', import.meta.url).pathname,
    '--port', String(port), '--origin', allowedOrigin, '--cmd', `${process.execPath} ${agent}`, '--log', path.join(dir, 'bridge.log')],
  { env: { ...process.env, KVN_BRIDGE_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.resume();
  t.after(async () => {
    for (const ws of sockets) if (ws.readyState === 1) ws.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGINT');
      await exited;
    }
  });
  for (let i = 0; i < 250 && !output.includes('pairing code:'); i++) {
    assert.equal(child.exitCode, null, 'bridge should remain running');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.match(output, /pairing code:/, 'bridge should become ready within 5 seconds');
  class PageSocket extends WebSocket {
    constructor(url, protocols) { super(url, { protocols, headers: { origin: allowedOrigin } }); sockets.push(this); }
  }
  return { port, token, dir, WebSocketImpl: PageSocket, stop: (signal = 'SIGINT') => child.kill(signal) };
}
