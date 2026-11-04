// Shared eval plumbing: route the worker's AI binding to Workers AI (through a proxy Worker)
// or to any OpenAI-compatible free-tier provider, with retries and usage capture.
export const OPENAI_COMPAT = {
  groq: ["https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY"],
  cerebras: ["https://api.cerebras.ai/v1/chat/completions", "CEREBRAS_API_KEY"],
  nvidia: ["https://integrate.api.nvidia.com/v1/chat/completions", "NVIDIA_API_KEY"],
  openrouter: ["https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY"],
  // Local stand-in for the in-browser (WebLLM) model: same weights family, served by Ollama.
  ollama: [(process.env.OLLAMA_HOST || "http://127.0.0.1:11434") + "/v1/chat/completions", null]
};

export const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    const res = await fn();
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= 8) return res;
    const wait = Number(res.headers.get("retry-after")) * 1000 || 5000 * (attempt + 1);
    await sleep(Math.min(wait, 60000) + Math.random() * 2000);
  }
}

// Usage telemetry per call (neurons for Workers AI, tokens elsewhere).
export const usage = [];

export async function openaiCompat(spec, input) {
  const [provider, ...rest] = spec.split(":");
  const [url, keyName] = OPENAI_COMPAT[provider] || [];
  if (!url || (keyName && !process.env[keyName])) throw new Error("No endpoint/key for " + provider);
  const { messages, max_tokens, temperature, stream, ...extra } = input;
  const body = { model: rest.join(":"), messages, max_tokens, temperature, stream: Boolean(stream), ...extra };
  const res = await withRetry(() => realFetch(url, {
    signal: AbortSignal.timeout(90000),
    method: "POST",
    headers: { ...(keyName ? { authorization: "Bearer " + process.env[keyName] } : {}), "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
  if (!res.ok) throw new Error(provider + " HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
  if (stream) return res.body;
  const json = await res.json();
  usage.push({ model: spec, ...(json.usage || {}) });
  return json;
}

export async function cloudflare(model, input) {
  const proxy = process.env.EVAL_CF_PROXY;
  if (!proxy) throw new Error("EVAL_CF_PROXY not set");
  const res = await withRetry(() => realFetch(proxy, {
    signal: AbortSignal.timeout(90000),
    method: "POST",
    headers: { "x-eval-key": process.env.EVAL_CF_KEY || "", "content-type": "application/json" },
    body: JSON.stringify({ model, input })
  }));
  if (input.stream) {
    if (!res.ok) throw new Error("cf HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    return res.body;
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "cf error");
  usage.push({ model, ...(json.out?.usage || {}) });
  return json.out;
}

export const runModel = (model, input) => model.startsWith("@cf/") ? cloudflare(model, input) : openaiCompat(model, input);

// Turnstile is mocked: local runs have no Cloudflare hostname to validate against.
export function mockTurnstile(hostname) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("challenges.cloudflare.com/turnstile")) return Response.json({ success: true, hostname });
    return realFetch(input, init);
  };
}
