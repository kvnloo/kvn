#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const contentDir = join(root, 'content');

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

const manifest = {
  version: 1,
  updated_at: new Date().toISOString(),
  files,
};

await writeFile(
  join(contentDir, 'MANIFEST.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log(`manifest: ${files.length} content files`);
