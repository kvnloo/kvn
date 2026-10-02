#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const OWNER = 'kvnloo';
const REPO = 'kvn';
const BRANCH = 'main';
const ROOT_DOCS = ['ENTRY.md', 'TOOLS.md', 'OPINIONS.md', 'VOICE.md'];

const bases = [
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`,
  `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}`,
];

function usage() {
  console.log(`Usage: node scripts/pull-kvn.mjs [--dir <cacheDir>]

Defaults:
  cache: $KVN_PULL_DIR or ~/.cache/kvn
  repo:  kvnloo/kvn@main
`);
}

function parseArgs(args) {
  let dir = process.env.KVN_PULL_DIR || null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true, dir };
    if (arg === '--dir') {
      dir = args[++i];
      if (!dir) throw new Error('--dir requires a path');
      continue;
    }
    if (arg.startsWith('--dir=')) {
      dir = arg.slice('--dir='.length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { help: false, dir };
}

function cacheDefault() {
  const home = homedir();
  return home ? join(home, '.cache', 'kvn') : resolve('kvn-cache');
}

function hash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchFile(path) {
  let lastError = null;
  for (const base of bases) {
    const url = `${base}/${path}`;
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}: ${url}`);
        continue;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`failed to fetch ${path}`);
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const cache = resolve(args.dir || cacheDefault());
  const contentDir = join(cache, 'content');
  await mkdir(contentDir, { recursive: true });

  const manifestBytes = await fetchFile('content/MANIFEST.json');
  const remote = JSON.parse(manifestBytes.toString('utf8'));
  const local = await readJson(join(contentDir, 'MANIFEST.json'), { files: [] });

  const localByPath = new Map((local.files || []).map((item) => [item.path, item]));
  const remotePaths = new Set();
  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const item of remote.files || []) {
    if (!item.path?.startsWith('content/') || !item.path.endsWith('.md')) continue;
    remotePaths.add(item.path);

    const destination = join(cache, item.path);
    const previous = localByPath.get(item.path);
    if (previous?.sha256 === item.sha256 && existsSync(destination)) continue;

    const bytes = await fetchFile(item.path);
    const actual = hash(bytes);
    if (item.sha256 && actual !== item.sha256) {
      throw new Error(`hash mismatch for ${item.path}: ${actual} != ${item.sha256}`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    if (previous) changed += 1;
    else added += 1;
  }

  for (const item of local.files || []) {
    if (!item.path?.startsWith('content/') || remotePaths.has(item.path)) continue;
    const destination = join(cache, item.path);
    if (existsSync(destination)) {
      await unlink(destination);
      removed += 1;
    }
  }

  for (const name of await readdir(contentDir)) {
    if (!name.endsWith('.md')) continue;
    const rel = `content/${name}`;
    if (!remotePaths.has(rel)) {
      await unlink(join(contentDir, name));
      removed += 1;
    }
  }

  await writeFile(join(contentDir, 'MANIFEST.json'), manifestBytes);

  const metaPath = join(cache, '.pull-meta.json');
  const meta = await readJson(metaPath, { doc_hashes: {} });

  for (const doc of ROOT_DOCS) {
    const bytes = await fetchFile(doc);
    const digest = hash(bytes);
    const destination = join(cache, doc);
    if (meta.doc_hashes?.[doc] === digest && existsSync(destination)) continue;

    await writeFile(destination, bytes);
    if (meta.doc_hashes?.[doc]) changed += 1;
    else added += 1;

    meta.doc_hashes ||= {};
    meta.doc_hashes[doc] = digest;
  }

  meta.updated_at = new Date().toISOString();
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');

  console.log(`pulled: ${added} new / ${changed} updated / ${removed} removed → ${cache}`);
}

main().catch((error) => {
  console.error(`pull-kvn: ${error?.message || error}`);
  process.exitCode = 1;
});
