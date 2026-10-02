#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const contentDir = join(root, 'content');
const manifestPath = join(contentDir, 'MANIFEST.json');

const names = (await readdir(contentDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort();

const files = [];
for (const name of names) {
  const abs = join(contentDir, name);
  const buf = await readFile(abs);
  files.push({
    path: relative(root, abs).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  });
}

let previous = { version: 1, updated_at: null, files: [] };
try {
  previous = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  // Rebuild from disk if the manifest is absent or invalid.
}

if (JSON.stringify(previous.files || []) === JSON.stringify(files)) {
  console.log(`manifest unchanged: ${files.length} content files`);
  process.exit(0);
}

const manifest = {
  version: 1,
  updated_at: new Date().toISOString(),
  files,
};

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest updated: ${files.length} content files`);
