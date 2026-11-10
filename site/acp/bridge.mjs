#!/usr/bin/env node
// kvn ACP bridge: lets a kvn page talk to YOUR local Hermes over ACP.
//
//   node bridge.mjs --origin https://where-you-opened-the-page
//
// What it does: listens on 127.0.0.1 only, spawns `hermes acp` in a fresh empty temp
// directory for each page connection, and relays ACP JSON-RPC frames between the page
// and Hermes. Nothing else. No dependencies, no network calls of its own, no data saved.
//
// Security: random pairing token per launch (sent as a WebSocket subprotocol), Origin
// allowlist, loopback Host check, one connection at a time. Hermes still asks the page
// for permission before running tools; the page shows those prompts to you.
//
// Options: --origin <url> (repeatable)  --port <n> (default 43190)
//          --cmd "<command>" (default "hermes acp")  --cwd <dir> (default: new temp dir)
//          --log <file> (default: <tmpdir>/kvn-acp-bridge-<port>.log) agent stderr and JSON-RPC errors, local only
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const origins = new Set(); // pages you allow, from --origin; none by default
args.forEach((a, i) => { if (a === '--origin' && args[i + 1]) origins.add(new URL(args[i + 1]).origin); });
const port = Number(opt('--port', process.env.KVN_BRIDGE_PORT || 43190));
const cmd = opt('--cmd', process.env.KVN_ACP_CMD || 'hermes acp');
const fixedCwd = opt('--cwd', null);
const logFile = opt('--log', process.env.KVN_BRIDGE_LOG || path.join(os.tmpdir(), `kvn-acp-bridge-${port}.log`));
// Diagnostics stay on this machine: written to logFile (0600), never relayed to the page.
function diag(kind, text) {
  try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${kind} ${String(text).slice(0, 8000)}\n`, { mode: 0o600 }); } catch {}
}
const token = process.env.KVN_BRIDGE_TOKEN || crypto.randomBytes(18).toString('base64url');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let busy = false;

const server = http.createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('loopback only'); }
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, busy, agent: cmd.split(' ')[0] })); }
  res.writeHead(404); res.end();
});

server.on('upgrade', (req, socket) => {
  const fail = (code, why) => { socket.end(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`); log(`refused: ${why}`); };
  if (!hostOk(req)) return fail(403, 'Bad Host');
  if (!origins.has(req.headers.origin || '')) return fail(403, 'Origin not allowed');
  const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
  if (!protos.includes(`kvn.${token}`)) return fail(401, 'Bad token');
  if (busy) return fail(409, 'Busy');
  const key = req.headers['sec-websocket-key'];
  if (!key) return fail(400, 'No key');
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`, 'Sec-WebSocket-Protocol: kvn.v1', '', ''].join('\r\n'));
  socket.setNoDelay(true);
  busy = true;
  session(socket);
});

function hostOk(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return ['127.0.0.1', 'localhost', '[::1]'].includes(host);
}

function session(socket) {
  const cwd = fixedCwd || fs.mkdtempSync(path.join(os.tmpdir(), 'kvn-acp-'));
  const [bin, ...rest] = cmd.split(' ').filter(Boolean);
  const child = spawn(bin, rest, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  log(`connected; started "${cmd}" in ${cwd}`); diag('session', `start ${cwd}`);
  let closed = false;
  const close = why => {
    if (closed) return; closed = true; busy = false;
    try { child.kill('SIGTERM'); } catch {}
    try { socket.end(frame(Buffer.from([0x03, 0xe8]), 0x8)); } catch {}
    socket.destroy();
    log(`closed (${why})`); diag('session', `closed ${why}`);
  };
  child.on('error', e => { send({ jsonrpc: '2.0', method: '_bridge/error', params: { message: `could not start ${bin}: ${e.code || e.message}` } }); close('spawn error'); });
  child.on('exit', code => { send({ jsonrpc: '2.0', method: '_bridge/exit', params: { code } }); close(`agent exited ${code}`); });
  let out = '';
  child.stdout.on('data', d => {
    if (Buffer.byteLength(out) + d.length > 1024 * 1024) return close('agent output limit');
    out += d;
    let i;
    while ((i = out.indexOf('\n')) >= 0) { const line = out.slice(0, i).trim(); out = out.slice(i + 1); if (line) { if (line.includes('"error"')) { try { const m = JSON.parse(line); if (m.error) diag('rpc-error', JSON.stringify({ id: m.id, error: m.error })); } catch {} } socket.write(frame(Buffer.from(line))); } }
  });
  child.stderr.on('data', d => { diag('stderr', d); send({ jsonrpc: '2.0', method: '_bridge/stderr', params: { text: `Agent diagnostic output withheld from the page; see ${path.basename(logFile)} on your machine.` } }); });
  function send(obj) { if (!closed) socket.write(frame(Buffer.from(JSON.stringify(obj)))); }

  let buf = Buffer.alloc(0), parts = [];
  socket.on('data', chunk => {
    if (buf.length + chunk.length > 2 * 1024 * 1024) return close('socket buffer limit');
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!masked) return close('unmasked client frame');
      if (len > 16 * 1024 * 1024) return close('frame too large');
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let j = 0; j < data.length; j++) data[j] ^= mask[j & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 0x8) return close('page closed');
      if (op === 0x9) { socket.write(frame(data, 0xA)); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        if (parts.reduce((n, part) => n + part.length, 0) + data.length > 1024 * 1024) return close('message limit');
        parts.push(data);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString('utf8'); parts = [];
        let msg;
        try { msg = JSON.parse(text); } catch { continue; }
        if (msg && (msg.method === 'session/new' || msg.method === 'session/load') && msg.params) {
          msg.params.cwd = cwd; // the page never chooses a directory on your machine
          msg.params.mcpServers = [];
        }
        child.stdin.write(JSON.stringify(msg) + '\n');
      }
    }
  });
  socket.on('close', () => close('socket closed'));
  socket.on('error', () => close('socket error'));
}

function frame(payload, op = 0x1) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n])
    : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}

function log(s) { process.stderr.write(`[bridge] ${s}\n`); }

server.listen(port, '127.0.0.1', () => {
  const pair = `${port}.${token}`;
  console.log(`\n  kvn ACP bridge on ws://127.0.0.1:${port}  (agent: ${cmd})`);
  console.log(`  allowed pages: ${[...origins].join(', ')}`);
  console.log(`\n  pairing code:  ${pair}\n`);
  for (const o of origins) if (!o.includes('localhost')) console.log(`  or open: ${o}/#acp=${pair}`);
  console.log('\n  Ctrl+C to stop. Hermes will ask the page before it runs any tool.\n');
});
process.on('SIGINT', () => process.exit(0));
