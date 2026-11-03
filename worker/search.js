// Lexical retrieval for a small public corpus: BM25 over title + body, with exact project-name
// matches and question-intent routing. Predictable, dependency-free, and identical in the
// Worker and the browser (copied to site/search.js by the build).
const STOP = new Set(
  "about again also and are can did does for from has have how into its kevin kvn like me more much our out raj raj an raj an the their them there these they this those what when where which who why will with would your you all tell know does do did have has his her was were what i am is of a an to in on at it he she be by or as that than so".split(" ")
);

export function keywords(value) {
  const matches = String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  return [...new Set(matches.filter((word) => !STOP.has(word)))];
}

// Light suffix stripping so "contributed", "contributions" and "contributing" meet.
export function stem(word) {
  const base = word.length > 5 ? word.replace(/(ations?|ings?|ions?|ed|es|s|ly|ers?)$/, "") : word.replace(/s$/, "");
  return base.length > 4 ? base.replace(/e$/, "") : base;
}

// A few topic words that never appear in the corpus but name things that do.
const SYNONYMS = {
  sport: ["tennis", "racquet", "racket"], sports: ["tennis", "racquet", "racket"], athletic: ["tennis"],
  tv: ["tizen", "plex"], television: ["tizen", "plex"], music: ["audio"], sound: ["audio"],
  dotfiles: ["files"], linux: ["hyprland", "files"], resume: ["portfolio"], cv: ["portfolio"]
};

export function expand(query) {
  const extra = [];
  for (const word of String(query || "").toLowerCase().match(/[a-z]+/g) || []) if (SYNONYMS[word]) extra.push(...SYNONYMS[word]);
  return extra.length ? query + " " + extra.join(" ") : query;
}

function terms(value) {
  const out = [];
  for (const word of String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9.+-]*[a-z0-9]|[a-z0-9]/g) || []) {
    if (word.length < 2 || STOP.has(word)) continue;
    out.push(stem(word));
    if (word.includes("-") || word.includes(".")) {
      for (const part of word.split(/[-.]/)) if (part.length > 2 && !STOP.has(part)) out.push(stem(part));
    }
  }
  return out;
}

// Intent cues: which living doc should answer a kind of question.
const INTENTS = [
  { test: /contribut|upstream|open[- ]source|\boss\b|pull request|\bprs?\b|merged|landed|commits?\b|maintainer|hermes|nous|omarchy|t3 ?code|noctalia/i, path: "CONTRIBUTIONS.md", boost: 2.5 },
  { test: /think|opinion|view|believe|feel|stance|care about|why does|values?\b|pledge|promot|sponsor|\bpay\b/i, path: "OPINIONS.md", boost: 2 },
  { test: /writ|voice|tone|lowercase|sound like|style|emoji/i, path: "VOICE.md", boost: 3.5 },
  { test: /built|build|tool|project|repo|install|made|work on|ship|anything .* for|which of/i, path: "TOOLS.md", boost: 1.5 },
  { test: /who (is|are)|tell me about (him|kevin|yourself)|introduce|what (do|does) (you|kevin|he) do|about (you|kevin)|your story/i, path: "content/2026-08-15_blog_boplog-about-faq.md", boost: 2 }
];
const CATALOG = /what (open[- ]source )?(tools|projects|things|stuff)|what (has|did) (he|kevin) (built|build|made|make|ship)|(list|show|explore).*(projects|tools|work)|(projects|tools) .*(built|made|maintain)|his (projects|tools|work)\b|(think|opinions?|views?|believe) (about|on) (things|stuff|tech|ai)?\s*\??$/i;

const BROAD = /who (is|are)|tell me about (him|kevin|yourself)|introduce|what (do|does) (you|kevin|he) do|about (you|kevin)|your story/i;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function retrieve(query, chunks, limit = 5) {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const qset = [...new Set(terms(expand(query)))];
  const raw = String(query || "").toLowerCase();
  const docs = chunks.map((chunk) => {
    const title = terms(chunk.title);
    const body = terms(chunk.text);
    return { chunk, title, body, len: title.length * 2 + body.length };
  });
  const avg = docs.reduce((sum, doc) => sum + doc.len, 0) / docs.length || 1;
  const df = new Map();
  for (const doc of docs) for (const term of new Set([...doc.title, ...doc.body])) df.set(term, (df.get(term) || 0) + 1);
  const idf = (term) => Math.log(1 + (docs.length - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));

  const intents = INTENTS.filter((intent) => intent.test.test(query));
  const scored = docs.map((doc) => {
    let score = 0;
    const tf = new Map();
    for (const term of doc.title) tf.set(term, (tf.get(term) || 0) + 2);
    for (const term of doc.body) tf.set(term, (tf.get(term) || 0) + 1);
    let matched = 0;
    const titleTerms = new Set(doc.title);
    for (const term of qset) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      matched++;
      score += idf(term) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * doc.len / avg));
      if (titleTerms.has(term)) score += 1.5 * idf(term);
    }
    // A question that names a project ("warp", "tmux-agent-fleet") should land on that project.
    const name = String(doc.chunk.title || "").toLowerCase();
    if (name.length > 2 && new RegExp("(^|[^a-z0-9])" + escape(name) + "([^a-z0-9]|$)").test(raw)) score += 6;
    if (matched && qset.length > 1) score *= 0.6 + 0.4 * matched / qset.length;
    for (const intent of intents) if (doc.chunk.path === intent.path) score += intent.boost * (score > 0 ? 1 : 0.5);
    if (CATALOG.test(query) && String(doc.chunk.id).endsWith(":catalog")) score += 8;
    // Prefer curated sources over the bulk runtime project feed. Boplog fork records quote the
    // upstream project's own description, which matches generic words without being Kevin's.
    if (doc.chunk.type === "public-project") score *= /my work on this fork/i.test(doc.chunk.text) ? 0.45 : 0.8;
    return { chunk: doc.chunk, score };
  });
  scored.sort((a, b) => b.score - a.score || String(a.chunk.id).localeCompare(String(b.chunk.id)));
  const picked = [];
  const perSection = new Map();
  for (const { chunk, score } of scored) {
    if (score <= 0.5 || picked.length >= Math.max(0, limit)) break;
    // At most two chunks from one section, so one long section cannot crowd out the rest.
    const key = (chunk.path || chunk.id) + "#" + chunk.title;
    if ((perSection.get(key) || 0) >= 2) continue;
    perSection.set(key, (perSection.get(key) || 0) + 1);
    picked.push(chunk);
  }
  if (picked.length || !BROAD.test(query)) return picked;
  return chunks.filter((chunk) => String(chunk.id).endsWith(":catalog") || chunk.path === "content/2026-08-15_blog_boplog-about-faq.md").slice(0, limit);
}

// Follow-ups ("how would an agent read it?") name nothing, so short questions also retrieve with
// the previous visitor question. Shared by the Worker and the in-browser model.
export function retrieveForTurn(question, history, chunks, limit = 6) {
  const previous = [...(history || [])].reverse().find((part) => part.role === "user")?.content || "";
  const contextual = previous && keywords(question).length < 3 ? retrieve(previous + " " + question, chunks, limit) : [];
  const hits = [];
  for (const hit of [...contextual, ...retrieve(question, chunks, limit)]) {
    if (hits.some((seen) => seen.id === hit.id || seen.parts?.includes(hit.id))) continue;
    // Two parts of one section become one source, so visitors never see the same title twice.
    const sibling = hits.find((seen) => seen.title === hit.title && seen.url === hit.url);
    if (sibling) {
      sibling.text += "\n" + hit.text;
      sibling.parts.push(hit.id);
    } else if (hits.length < limit) {
      hits.push({ ...hit, parts: [hit.id] });
    }
  }
  return hits;
}

// Small models often answer correctly but skip the [n] markers. When an answer has no citation
// at all, attach each factual sentence to the one source it overlaps most, if the overlap is
// strong; anything weaker stays uncited rather than wrongly cited.
export function autoCite(answer, hits) {
  const text = String(answer || "");
  if (!hits?.length || /\[\d{1,2}\]/.test(text)) return text;
  const sourceWords = hits.map((hit) => new Set(keywords(hit.title + " " + hit.text).map(stem)));
  const cite = (sentence) => {
    const body = sentence.trimEnd();
    if (body.length < 40 || /:$/.test(body) || /\/kvn only covers|can't help|no public evidence/i.test(body)) return sentence;
    const words = keywords(body).map(stem);
    if (words.length < 4) return sentence;
    let best = -1;
    let bestScore = 0;
    const lower = body.toLowerCase();
    let bestShared = 0;
    sourceWords.forEach((set, index) => {
      const shared = words.filter((word) => set.has(word)).length;
      // A source whose own title the sentence names (a project page) beats a catalog line.
      const score = shared + (hits[index].title.length > 2 && lower.includes(hits[index].title.toLowerCase()) ? 1.5 : 0);
      if (score > bestScore) { best = index; bestScore = score; bestShared = shared; }
    });
    if (best < 0 || bestShared < 3 || bestShared / words.length < 0.4) return sentence;
    const marker = " [" + (best + 1) + "]";
    const end = /[.!?]$/.test(body) ? body.slice(0, -1) + marker + body.slice(-1) : body + marker;
    return end + sentence.slice(body.length);
  };
  // Sentences end at . ! ? followed by whitespace, so "6.5", "TOOLS.md" and URLs stay whole.
  return text.split("\n").map((line) => line.split(/(?<=[.!?])(?=\s+)/).map(cite).join("")).join("\n");
}
