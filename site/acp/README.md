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
- This bridge is not a sandbox. Hermes retains its native tools and approval policy; a tool can run without a
  page permission request. The no-tools prompt is an instruction, not an enforced security boundary.
  For requests Hermes does send, `AcpClient` emits a `permission` event and waits for a choice.
  Only offered option IDs are accepted, once per callback, on the original connection. Other choices cancel.
- Agent stderr, non-JSON stdout diagnostics, and JSON-RPC error details go to a local log created with mode
  0600. The bridge replaces RPC error messages and data before forwarding the response to the page.
- On Linux and macOS, disconnect, agent exit, SIGINT, and SIGTERM stop the owned process group. Cleanup sends
  SIGTERM, then SIGKILL after one second, and holds the connection slot until that deadline. Working files
  remain in the temporary directory. Tools that create a separate process group can escape this cleanup.
  Windows only stops the direct agent process. This is lifecycle cleanup, not a sandbox or a spending cap.
- No dependencies. Node 22+ (global `WebSocket`) for the tests: `node --test tests/acp.test.mjs tests/hermes.test.mjs` (after `npm run build:site`).

Options: `--port` (43190), `--cmd` ("hermes acp"), `--cwd`, `--log`; env `KVN_BRIDGE_TOKEN`, `KVN_BRIDGE_PORT`,
`KVN_ACP_CMD`, `KVN_BRIDGE_LOG`.

Extracted from Kevin's job-application reviewer, where it was checked end to end against Hermes 0.22.5 (ACP v1).
