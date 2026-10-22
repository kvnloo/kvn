// Pure lexical retrieval: predictable, low-latency and free for a small public corpus.
const STOP = new Set(
  "about again also and are can did does for from has have how into its kevin kvn like me more much our out raj raj an raj an the their them there these they this those what when where which who why will with would your you all tell know does do did have has his her was were what i am is of a an to in on at it he she be by or as that than so".split(" ")
);

export function keywords(value) {
  const matches = String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  return [...new Set(matches.filter((word) => !STOP.has(word)))];
}

export function retrieve(query, chunks, limit = 5) {
  if (!Array.isArray(chunks)) return [];
  const words = keywords(query);
  const broad = /who (is|are)|tell me about|introduce|what (do|does) (you|kevin)|about (you|kevin)|your story/i.test(query);
  const ranked = chunks.map((chunk) => {
    const title = String(chunk.title || "").toLowerCase();
    const body = String(chunk.text || "").toLowerCase();
    const url = String(chunk.url || "").toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 6;
      if (body.includes(word)) score += 2;
      if (url.includes(word)) score += 0.5;
    }
    if (words.length > 1 && words.every((word) => title.includes(word) || body.includes(word))) score += 3;
    if (broad && /^(ENTRY|TOOLS|OPINIONS|VOICE)\.md$/.test(chunk.path || "")) score += 1;
    return { ...chunk, _score: score };
  });
  ranked.sort((a, b) => b._score - a._score || String(a.id).localeCompare(String(b.id)));
  const matches = ranked.filter((chunk) => chunk._score > 0).slice(0, Math.max(0, limit));
  if (matches.length || !broad) return matches.map(({ _score, ...chunk }) => chunk);
  return ranked.filter((chunk) => ["TOOLS.md", "OPINIONS.md", "ENTRY.md"].includes(chunk.path))
    .slice(0, limit).map(({ _score, ...chunk }) => chunk);
}
