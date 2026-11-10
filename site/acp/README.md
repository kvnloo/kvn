# acp: bring your own Hermes

A minimal [Agent Client Protocol](https://agentclientprotocol.com) client for the browser (`acp.js`) and a
local bridge (`bridge.mjs`) that connects it to the Hermes on your machine. You use your own agent, keys and
models; the page never sees them.

```sh
node site/acp/bridge.mjs --origin https://<the page you opened>
# prints a pairing code; paste it into the page (or open the printed #acp= link)
```

- The bridge listens on 127.0.0.1 only. It accepts one page at a time from an `--origin` you allow, and checks a
  fresh pairing token on every launch.
- Each connection runs `hermes acp` in a new empty temp directory. The page can't choose a directory or add
  MCP servers.
- Hermes asks the page before it runs any tool. `AcpClient` emits a `permission` event and never answers by itself.
- Agent stderr and JSON-RPC error text go to a local 0600 log. They are never sent to the page.
- No dependencies. Node 22+ (global `WebSocket`) for the tests: `node --test tests/acp.test.mjs tests/hermes.test.mjs` (after `npm run build:site`).

Options: `--port` (43190), `--cmd` ("hermes acp"), `--cwd`, `--log`; env `KVN_BRIDGE_TOKEN`, `KVN_BRIDGE_PORT`,
`KVN_ACP_CMD`, `KVN_BRIDGE_LOG`.

Extracted from Kevin's job-application reviewer, where it was checked end to end against Hermes 0.22.5 (ACP v1).
