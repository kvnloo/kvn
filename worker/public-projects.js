// Supplemental public project index from the already-maintained Boplog feed.
// Boplog records may include contributed forks; entries are NOT sole authorship claims.
const ORIGIN = "https://kvnloo.github.io/boplog/data/";
const MAX_PROJECTS = 650;
const CACHE_MILLIS = 15 * 60 * 1000;
let cache = { expires: 0, chunks: [], generatedAt: null };
let pending = null;

function trustedURL(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.hostname === "github.com" && url.pathname.startsWith("/kvnloo/")) return url.toString();
    if (url.hostname === "kvnloo.github.io" && url.pathname.startsWith("/")) return url.toString();
  } catch { /* Ignore malformed source URLs. */ }
  return null;
}

export function toPublicChunks(manifest, datasets) {
  const files = manifest?.files;
  if (!Array.isArray(files) || !Array.isArray(datasets)) return [];
  const seen = new Set();
  const chunks = [];
  for (const dataset of datasets) {
    if (!Array.isArray(dataset?.projects)) continue;
    for (const item of dataset.projects) {
      const name = String(item?.name || "").trim();
      const link = trustedURL(item?.url) ||
        (Array.isArray(item?.links) ? item.links.map((entry) => trustedURL(entry.url)).find(Boolean) : null);
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name) || !link || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const kind = String(item.kindName || item.kind || "project").slice(0, 70);
      const summary = String(item.description || "").replace(/\s+/g, " ").slice(0, 460);
      chunks.push({
        id: "boplog:" + name.toLowerCase(), path: "boplog/" + name,
        title: name, url: link, type: "public-project",
        text: "Public Boplog " + kind + " record for " + name + ". " + summary +
          " Listed as public activity; a fork or contribution does not establish sole authorship."
      });
      if (chunks.length >= MAX_PROJECTS) return chunks;
    }
  }
  return chunks;
}

export async function getPublicProjectIndex(fetcher = fetch) {
  if (cache.expires > Date.now()) return cache;
  if (pending) return pending;
  pending = (async () => {
    try {
      const init = { cf: { cacheTtl: 3600, cacheEverything: true } };
      const response = await fetcher(ORIGIN + "manifest.json", init);
      if (!response.ok) throw new Error("Boplog manifest unavailable");
      const manifest = await response.json();
      const names = (Array.isArray(manifest.files) ? manifest.files : [])
        .filter((name) => /^projects-20\d\d\.json$/.test(name)).slice(0, 12);
      if (!names.length) throw new Error("No authorized project files");
      const responses = await Promise.all(names.map((name) => fetcher(ORIGIN + name, init)));
      const datasets = await Promise.all(responses.map(async (result) =>
        result.ok ? result.json() : null
      ));
      const chunks = toPublicChunks(manifest, datasets);
      if (!chunks.length) throw new Error("Empty public project index");
      cache = {
        chunks,
        generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : null,
        expires: Date.now() + CACHE_MILLIS
      };
    } catch {
      // If Boplog is down, keep the last successful snapshot (or curated /kvn).
      cache.expires = Date.now() + 60000;
    } finally {
      pending = null;
    }
    return cache;
  })();
  return pending;
}
