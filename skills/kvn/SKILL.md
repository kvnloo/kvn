---
name: kvn
description: >
  Use kvn's latest public knowledge, tools, viewpoints, workflows, and voice.
  Use on /kvn or when explicitly asked to answer from kvn's living distillation.
user-invocable: true
metadata:
  short-description: "Use kvn's living public knowledge base."
---

# /kvn

Load the latest living knowledge base from `kvnloo/kvn` through the public pull script, then answer from the local cache. Do not guess file contents.

## 1. Pull

Download `scripts/pull-kvn.mjs` from:

- `https://raw.githubusercontent.com/kvnloo/kvn/main/scripts/pull-kvn.mjs`
- fallback: `https://cdn.jsdelivr.net/gh/kvnloo/kvn@main/scripts/pull-kvn.mjs`

Run:

```sh
node /path/to/pull-kvn.mjs --dir <cache>
```

The default cache is `$KVN_PULL_DIR` or `~/.cache/kvn`.

If the pull fails, stop and report the failure. Do not substitute stale guesses.

## 2. Read

After a successful pull, read the full local copies of:

- `ENTRY.md`
- `TOOLS.md`
- `OPINIONS.md`
- `VOICE.md`

Open matching files under `content/` only when the request needs primary-source evidence or fuller context.

## 3. Answer

Follow `ENTRY.md`.
