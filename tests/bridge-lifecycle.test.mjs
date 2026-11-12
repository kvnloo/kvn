import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { AcpClient } from '../site/acp/acp.js';
import { startBridge } from './helpers/bridge.mjs';

const agent = String.raw`
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
process.on('SIGTERM', () => {});
const tool = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
const ready = new Promise(resolve => tool.stdout.once('data', resolve));
createInterface({ input: process.stdin }).on('line', async line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') {
    await ready;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { agentPid: process.pid, toolPid: tool.pid } }) + '\n');
  } else if (m.method === 'test/exit') process.exit(0);
});
`;

function running(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux' && /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

for (const ending of ['disconnect', 'agent exit', 'SIGINT', 'SIGTERM']) {
  test(`bridge lifecycle stops owned agent and tool on ${ending}`, { timeout: 10000, skip: process.platform === 'win32' }, async t => {
    const bridge = await startBridge(t, agent);
    const client = new AcpClient(bridge);
    await client.open();
    const { agentPid, toolPid } = await client.request('initialize', {});
    t.after(() => {
      for (const pid of [agentPid, toolPid]) {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    });
    assert.ok(running(agentPid) && running(toolPid));
    const closed = once(client, 'close');
    if (ending === 'disconnect') client.close();
    else if (ending === 'agent exit') client.send({ method: 'test/exit' });
    else bridge.stop(ending);
    await closed;
    if (ending === 'disconnect') {
      const status = await (await fetch(`http://127.0.0.1:${bridge.port}/health`)).json();
      assert.equal(status.busy, true, 'must not admit another page while old tools can still run');
    }
    assert.equal(await waitFor(() => !running(agentPid) && !running(toolPid)), true, 'agent or descendant survived cleanup');
    if (ending === 'disconnect' || ending === 'agent exit') {
      assert.equal(await waitFor(async () => !(await (await fetch(`http://127.0.0.1:${bridge.port}/health`)).json()).busy), true);
      const next = new AcpClient(bridge);
      await next.open();
      const fresh = await next.request('initialize', {});
      t.after(() => {
        for (const pid of [fresh.agentPid, fresh.toolPid]) {
          try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      });
      assert.notEqual(fresh.agentPid, agentPid, 'new page gets a fresh process');
      next.close();
    }
  });
}
