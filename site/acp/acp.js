// Minimal ACP (Agent Client Protocol) client over the local bridge WebSocket.
// The page is the ACP client; your Hermes (`hermes acp`) is the agent.
export class AcpClient extends EventTarget {
  constructor({ port, token, WebSocketImpl = globalThis.WebSocket }) {
    super();
    this.url = `ws://127.0.0.1:${port}`;
    this.token = token;
    this.WS = WebSocketImpl;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.agent = null;
    this.models = null;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new this.WS(this.url, ['kvn.v1', `kvn.${this.token}`]);
      this.ws = ws;
      ws.onopen = () => { settled = true; resolve(); };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Could not reach the bridge. Is it running, and is the pairing code current?')); } };
      ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error('Connection closed')); this.pending.clear(); this.emit('close'); };
      ws.onmessage = ev => this.onFrame(ev.data);
    });
  }
  onFrame(data) {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(Object.assign(new Error(`Agent request failed during ${p.method}`), { code: msg.error.code, phase: p.method })) : p.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) return this.onRequest(msg);
    if (msg.method === 'session/update') return this.emit('update', msg.params?.update || {});
    if (msg.method?.startsWith('_bridge/')) return this.emit('bridge', { kind: msg.method.slice(8), ...msg.params });
  }
  onRequest(msg) {
    const reply = result => this.send({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message) => this.send({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    if (msg.method === 'session/request_permission') {
      // Always surfaced to the human; never auto-answered.
      this.emit('permission', { params: msg.params, choose: optionId => reply(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }) });
      return;
    }
    fail(-32601, `${msg.method} is not offered by this page`);
  }
  send(obj) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(obj)); }
  request(method, params, timeoutMs = method === 'session/prompt' ? 300000 : 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== 1) return reject(new Error('Bridge is not connected'));
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (method === 'session/prompt') this.cancel();
        reject(new Error(`Agent request timed out during ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch { this.pending.get(id)?.reject(new Error('Bridge send failed')); this.pending.delete(id); }
    });
  }
  async start() {
    await this.open();
    const init = await this.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'kvn', title: 'kvn', version: '1.0.0' } });
    this.agent = init?.agentInfo || null;
    const s = await this.request('session/new', { cwd: '/', mcpServers: [] });
    this.sessionId = s.sessionId;
    this.models = s.models || null;
    return { agent: this.agent, models: this.models, protocolVersion: init?.protocolVersion };
  }
  prompt(text) { return this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }); }
  cancel() { this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } }); }
  close() { try { this.ws?.close(); } catch {} }
}
