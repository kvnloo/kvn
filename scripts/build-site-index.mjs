import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = ["ENTRY.md", "OPINIONS.md", "TOOLS.md", "VOICE.md"];
const base = "https://github.com/kvnloo/kvn/blob/main/";
const chunks = [];

function safeSourceURL(text, fallback) {
  const match = text.match(/^url:\s*["']?(https:\/\/[^\s"']+)/m);
  if (!match) return fallback;
  try {
    const url = new URL(match[1]);
    const xPost = (url.hostname === "x.com" || url.hostname === "twitter.com") && /^\/_kvnloo\/status\/\d+/.test(url.pathname);
    const boplog = url.hostname === "kvnloo.github.io" && url.pathname.startsWith("/boplog/");
    return xPost || boplog ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function addSections(path, raw, type, url) {
  const clean = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  const sections = clean.split(/\n(?=##\s)/g);
  sections.forEach((section, number) => {
    const title = section.match(/^##\s+(.+)$/m)?.[1]?.trim() || path.split("/").at(-1);
    const content = section.replace(/^##\s+.+$/m, "").trim();
    if (!content) return;
    const paragraphs = content.split(/\n\s*\n/);
    let buf = "";
    let part = 0;
    function emit() {
      if (buf.trim()) chunks.push({ id: path + ":" + number + ":" + part++, path, title, url, type, text: buf.trim() });
      buf = "";
    }
    for (const paragraph of paragraphs) {
      if (buf && buf.length + paragraph.length + 2 > 1400) emit();
      if (paragraph.length > 1400) {
        if (buf) emit();
        for (let i = 0; i < paragraph.length; i += 1400) {
          buf = paragraph.slice(i, i + 1400);
          emit();
        }
      } else {
        buf += (buf ? "\n\n" : "") + paragraph;
      }
    }
    emit();
  });
}

for (const path of docs) {
  const content = readFileSync(join(root, path), "utf8");
  addSections(path, content, "distillation", base + path);
}

const manifest = JSON.parse(readFileSync(join(root, "content/MANIFEST.json"), "utf8"));
if (!Array.isArray(manifest.files)) throw new Error("Expected manifest.files array");
for (const item of manifest.files) {
  if (!/^content\/[a-zA-Z0-9._-]+\.md$/.test(item.path)) throw new Error("Unexpected manifest path: " + item.path);
  const raw = readFileSync(join(root, item.path), "utf8");
  const actual = createHash("sha256").update(raw).digest("hex");
  if (actual !== item.sha256) throw new Error("Source hash mismatch: " + item.path);
  addSections(item.path, raw, item.source, safeSourceURL(raw, base + item.path));
}

const digest = createHash("sha256").update(JSON.stringify(chunks)).digest("hex").slice(0, 16);
const data = { schemaVersion: 1, digest, sourceRepository: "https://github.com/kvnloo/kvn", chunks };
mkdirSync(join(root, "site"), { recursive: true });
writeFileSync(join(root, "site/knowledge.json"), JSON.stringify(data, null, 2) + "\n");
console.log("Generated " + chunks.length + " public evidence chunks (" + digest + ")");
