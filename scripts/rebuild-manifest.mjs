#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const contentDir = join(root, 'content');
const manifestPath = join(contentDir, 'MANIFEST.json');

function scalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return null;
  let value = match[1].trim();
  if (value === 'null' || value === '~') return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function metadata(markdown, path) {
  if (!markdown.startsWith('---\n')) {
    throw new Error(`${path}: missing YAML frontmatter`);
  }
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`${path}: unterminated YAML frontmatter`);

  const frontmatter = markdown.slice(4, end);
  const source = scalar(frontmatter, 'source');
  const id = scalar(frontmatter, 'id');
  const createdAt = scalar(frontmatter, 'created_at');

  if (!source) throw new Error(`${path}: missing source`);
  if (!id) throw new Error(`${path}: missing id`);
  if (!createdAt) throw new Error(`${path}: missing created_at`);

  return { source, id: String(id), created_at: createdAt };
}

const names = (await readdir(contentDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort();

const files = [];
for (const name of names) {
  const abs = join(contentDir, name);
  const buf = await readFile(abs);
  const path = relative(root, abs).replaceAll('\\', '/');
  const meta = metadata(buf.toString('utf8'), path);

  files.push({
    created_at: meta.created_at,
    id: meta.id,
    path,
    sha256: createHash('sha256').update(buf).digest('hex'),
    source: meta.source,
  });
}

let previousFiles = [];
try {
  const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  previousFiles = previous.files || [];
} catch {
  // Rebuild from disk if the manifest is absent or invalid.
}

if (JSON.stringify(previousFiles) === JSON.stringify(files)) {
  console.log(`manifest unchanged: ${files.length} content files`);
  process.exit(0);
}

await writeFile(
  manifestPath,
  JSON.stringify({ files }, null, 2) + '\n',
);

console.log(`manifest updated: ${files.length} content files`);
