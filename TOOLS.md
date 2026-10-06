# TOOLS.md

Public tools and repositories owned or clearly maintained by kvn. Curated for substance; placeholders, empty scaffolds, and bookmark-only forks are omitted.

## kvn

https://github.com/kvnloo/kvn

Living public distillation of Kevin Rajan: `OPINIONS.md`, `VOICE.md`, `TOOLS.md`, `ENTRY.md`, plus a raw `content/` ledger and `scripts/pull-kvn.mjs` for incremental cache sync. For anyone who wants `/kvn` answers grounded in public evidence.

Try: `npx skills add kvnloo/kvn -g` then `/kvn <question>`, or `node scripts/pull-kvn.mjs`.

Status: active (this repo).

## boplog

https://github.com/kvnloo/boplog · site: https://kvnloo.github.io/boplog/

Static public build log of GitHub repositories Kevin has actually committed to, with Atom feed, year-partitioned JSON, `llms.txt`, and agent/CLI helpers. For agents and humans auditing public build history.

Try: browse https://kvnloo.github.io/boplog/ or `https://kvnloo.github.io/boplog/feed.xml`; JSON via https://kvnloo.github.io/boplog/data/manifest.json.

Status: active.

## evolve

https://github.com/kvnloo/evolve · docs: https://kvnloo.github.io/evolve/

Open autonomous multi-agent development framework (SPARC / Claude Flow style orchestration, C(RAID) outer loop). For teams exploring AI SDLC agent swarms with systematic methodology.

Try: start at https://kvnloo.github.io/evolve/ and the repo README.

Status: public / meaningful substance (featured on Boplog).

## tmux-agent-fleet

https://github.com/kvnloo/tmux-agent-fleet

Zero-daemon, harness-neutral tmux command palette (`prefix + f`) to find and jump among coding-agent panes without owning sessions or injecting daemons. For people running multiple CLI coding agents in tmux.

Try: install as a TPM plugin from the repo README, then `prefix + f`.

Status: active / experimental.

## verified-oss-loop

https://github.com/kvnloo/verified-oss-loop

Project-neutral protocol + onboarding kit for roadmap-driven, evidence-backed human and agent OSS contributions (claim leases, receipts, independent verification, human merge authority).

Try: `git clone https://github.com/kvnloo/verified-oss-loop` then `./bin/oss-onboard /path/to/repo` (see README).

Status: active.

## aodl

https://github.com/kvnloo/aodl · site: https://kvnloo.github.io/aodl/

Typed IR / schema + fail-closed validator for agent orchestration graphs (specification and dry-run compiler notes; not a scheduler). For people designing explicit agent topologies.

Try: browse https://kvnloo.github.io/aodl/ or run the repo’s `python3 tests/validate.py`.

Status: active / experimental.

## ace

https://github.com/kvnloo/ace · demo: https://kvnloo.github.io/ace/

Public digital-twin demo of an autonomous multi-floor racket / indoor racquet sports facility (React, Three.js). For demos of operational 3D twins.

Try: https://kvnloo.github.io/ace/

Status: active demo.

## .files

https://github.com/kvnloo/.files · site: https://kvnloo.github.io/.files/

Personal Linux/macOS dotfiles and onboarding installer (Hyprland, tmux, shells, agent skills). Template for reproducible desktop/agent setup—not a multi-tenant product.

Try: clone and `./install`, or follow harness onboarding in the README.

Status: active personal toolkit.

## portfolio

https://github.com/kvnloo/portfolio · site: https://kvnloo.github.io/portfolio/

Personal portfolio site (AI systems, agent tooling, iOS/audio, frontend), including interactive demos. Professional showcase.

Try: https://kvnloo.github.io/portfolio/

Status: active.

## gh-contrib-archive

https://github.com/kvnloo/gh-contrib-archive · site: https://kvnloo.github.io/gh-contrib-archive/

Public-safe visualization of Kevin’s GitHub issues, PRs, comments, and commit counts (private work counted, never opened).

Try: https://kvnloo.github.io/gh-contrib-archive/

Status: active.

## baseline-tennis

https://github.com/kvnloo/baseline-tennis · site: https://kvnloo.github.io/baseline-tennis/

Interactive open-data tennis map, charts, and statistical query engine.

Try: https://kvnloo.github.io/baseline-tennis/

Status: experimental.

## AudioEngine

https://github.com/kvnloo/AudioEngine · docs: https://kvnloo.github.io/AudioEngine/

Legacy 2017 iOS real-time noise meter + 14-band dual-channel EQ (JubiAudio Phase I). Historical / docs cleanup since; not current product work.

Try: https://kvnloo.github.io/AudioEngine/

Status: historical.

## warp

https://github.com/kvnloo/warp

Fast Plex client for a Samsung QN85B TV (Tizen 6.5, Chromium M85 target), GPL-3.0-only. Builds a signed Tizen widget and installs/launches it on the TV over the local network; the red button opens an on-device performance receipt. For people who want a snappier Plex front end on an older Samsung TV.

Try: `npm ci && npm run dev` for the browser UI, or set `TV_IP` in `.env` and `npm run tv` to build, package, install, and launch on the TV.

Status: experimental (first Tizen vertical slice, Oct 2026).

## Not included (on purpose)

Large numbers of public forks without Kevin-owned product substance, empty placeholder scaffolds, and stealth/company-OS mirror repos were considered from the public `kvnloo` owner list and Boplog feed but left out of this curated map. Prefer Boplog JSON for exhaustive project inventory: https://kvnloo.github.io/boplog/data/manifest.json.
