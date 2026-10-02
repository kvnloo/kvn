<h1 align="center">/kvn</h1>

<h3 align="center">A living public distillation of Kevin Rajan</h3>

`/kvn` is a near-realtime distillation of public experience, viewpoints,
tools, workflows, and voice.

Its architecture follows the public pattern demonstrated by
[kunchenguid/kun](https://github.com/kunchenguid/kun): a thin Agent Skill pulls
a living knowledge base, then answers from a local cache.

## Quick start

```sh
npx skills add kvnloo/kvn -g
```

Then:

```text
/kvn <question>
```

## How it works

```text
daily Grok Bot refresh                /kvn question
        │                                   │
        ▼                                   ▼
refresh living docs                node pull-kvn.mjs
+ raw public ledger               → ~/.cache/kvn
        │                                   │
        ▼                                   ▼
OPINIONS.md  TOOLS.md               read ENTRY + docs
VOICE.md     ENTRY.md                + selective content/
content/MANIFEST.json                        │
        └────────────────────────────────────┘
                         │
                         ▼
                  grounded answer
```

### Runtime pull

1. Download and run `scripts/pull-kvn.mjs`.
2. Read the full cached copies of `ENTRY.md`, `TOOLS.md`, `OPINIONS.md`,
   and `VOICE.md`.
3. Open matching raw files under `content/` only when primary evidence is
   needed.
4. If the pull fails, stop instead of guessing.

The default cache is `$KVN_PULL_DIR` or `~/.cache/kvn`.

### Daily living-doc refresh

The Grok Bot process is documented in `GROK_BOT.md` and runs daily in
America/Chicago.

Current authorized inputs:

- public X posts/replies/quotes from `@_kvnloo`;
- public repositories owned by `kvnloo`;
- the public Boplog/build-log feed.

The process mirrors the reference architecture:

- `OPINIONS.md` and `VOICE.md` are compacted from authored public material.
  New signals are merged and tightened into the existing map before anything
  is appended.
- `content/` holds one raw Markdown record per authored public item.
- `content/MANIFEST.json` indexes those records by source, stable ID,
  timestamp, path, and SHA-256.
- `TOOLS.md` is refreshed from Kevin-owned public, non-archived repositories
  with meaningful substance.

Substack and YouTube are not inferred automatically; they can be added later
from canonical account URLs.

## Incremental public ledger

```sh
node scripts/rebuild-manifest.mjs
node scripts/pull-kvn.mjs
node scripts/pull-kvn.mjs --dir /tmp/kvn-cache
```

First empty cache = full pull. Later pulls download only new/changed content,
remove items deleted from the manifest, and hash-sync the root docs.

## Files

- `ENTRY.md` — answer/routing contract.
- `OPINIONS.md` — compact map of evidenced public viewpoints.
- `VOICE.md` — stable public voice patterns.
- `TOOLS.md` — curated public tools/repositories.
- `content/` — raw public evidence.
- `content/MANIFEST.json` — incremental ledger index.
- `skills/kvn/SKILL.md` — thin Agent Skill.
- `GROK_BOT.md` — initial backfill + daily refresh process.

## Provenance

Architecture inspired by
[kunchenguid/kun](https://github.com/kunchenguid/kun). The implementation and
Kevin-specific knowledge are maintained independently here.
