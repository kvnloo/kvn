<h1 align="center">/kvn</h1>

<h3 align="center">A living public distillation of kvn</h3>

`/kvn` is a near-realtime distillation of public experience, opinions, tools, workflows, and voice.

The architecture intentionally follows the same pattern as [kunchenguid/kun](https://github.com/kunchenguid/kun): a thin Agent Skill pulls a living knowledge base, then answers from the local cache. This repository reimplements that pattern for `kvnloo/kvn`.

## Quick start

```sh
npx skills add kvnloo/kvn -g
```

Then invoke:

```text
/kvn <question>
```

## How it works

```text
daily Grok Bot routine                /kvn question
        │                                   │
        ▼                                   ▼
refresh living docs                node pull-kvn.mjs
on main                             → ~/.cache/kvn
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

### What the skill loads

1. Run `scripts/pull-kvn.mjs`.
2. Read the full cached copies of `ENTRY.md`, `TOOLS.md`, `OPINIONS.md`, and `VOICE.md`.
3. Open matching raw files under `content/` only when the question needs source evidence.
4. If the pull fails, stop instead of guessing.

The default cache is `$KVN_PULL_DIR` or `~/.cache/kvn`.

## Living docs

- `ENTRY.md` — routing and answer contract.
- `OPINIONS.md` — compact map of public viewpoints.
- `VOICE.md` — observed writing/speaking patterns.
- `TOOLS.md` — public tools and repositories.
- `content/` — raw public-source ledger.
- `content/MANIFEST.json` — hash index used for incremental sync.

Keep the four root docs compact. Raw source material belongs in `content/`.

## Grok Bot

`GROK_BOT.md` contains the setup message and the daily refresh routine for a Grok Bot that maintains this repository and answers from it.

## Incremental pull

```sh
node scripts/pull-kvn.mjs
node scripts/pull-kvn.mjs --dir /tmp/kvn-cache
```

The pull is manifest-driven: new or changed raw items are downloaded, removed entries are deleted locally, and root docs are hash-synced.

## Provenance

Architecture inspired by [kunchenguid/kun](https://github.com/kunchenguid/kun). This repository contains an independent implementation and does not copy Kun's personal knowledge base.
