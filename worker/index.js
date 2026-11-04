import { getPublicProjectIndex } from "./public-projects.js";
import { readChatInput } from "./request.js";
import { answerText, normalizeStream, shapeInput } from "./inference.js";
import { buildMessages, cleanHistory } from "./prompt.js";
import { autoCite, retrieveForTurn } from "./search.js";


// Default free model; a deployment can override it with the FREE_MODEL variable.
const DEFAULT_FREE_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const MAX_TOKENS = 700;
const freeModel = (env) => (typeof env.FREE_MODEL === "string" && env.FREE_MODEL.trim()) || DEFAULT_FREE_MODEL;
const PROVIDERS = Object.freeze({
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "qwen/qwen3.8-27b" },
  openrouter: { endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free" }
});

function reply(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

async function checkTurnstile(secret, token, ip, hostname) {
  if (!secret || typeof token !== "string" || token.length > 2048 || !token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip || "" })
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === hostname;
  } catch {
    return false;
  }
}

function streamAnswer(upstream, sources, model, hits = []) {
  const modelStream = normalizeStream(upstream);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("event: sources\ndata: " + JSON.stringify({ sources, model }) + "\n\n"));
      const reader = modelStream.getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const bytes = typeof value === "string" ? encoder.encode(value) : value;
          text += decoder.decode(bytes, { stream: true });
          controller.enqueue(bytes);
        }
        // Uncited answers get their markers after the fact; the page swaps in this final text.
        const answer = text.split("\n\n").map((frame) => {
          try { return JSON.parse(frame.replace(/^data: /, "")).delta || ""; } catch { return ""; }
        }).join("");
        const cited = autoCite(answer, hits);
        if (cited !== answer) controller.enqueue(encoder.encode("event: final\ndata: " + JSON.stringify({ answer: cited }) + "\n\n"));
      } catch {
        controller.enqueue(encoder.encode('event: error\ndata: {"error":"Inference stream interrupted."}\n\n'));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    }
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff"
    }
  });
}

async function chat(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ error: "Cross-origin requests are disabled." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return reply({ error: "Expected JSON." }, 415);
  const parsed = await readChatInput(request);
  if (parsed.error) return reply({ error: parsed.error }, parsed.status);
  const input = parsed.input;

  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const provider = input?.provider || "cloudflare";
  if (!question || question.length > 700) return reply({ error: "Question must be 1–700 characters." }, 400);
  if (!["cloudflare", "groq", "openrouter"].includes(provider)) return reply({ error: "Unsupported provider." }, 400);

  // Anonymous request budgeting: intentionally modest to protect the free allocation.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.RATE_LIMIT) {
    const { success } = await env.RATE_LIMIT.limit({ key: ip });
    if (!success) return reply({ error: "Rate limited. Please try later or use a different network." }, 429);
  }

  let index;
  try {
    const url = new URL("/knowledge.json", request.url);
    const response = await env.ASSETS.fetch(new Request(url));
    if (!response.ok) throw new Error("Index unavailable");
    index = await response.json();
    if (!Array.isArray(index.chunks)) throw new Error("Malformed index");
  } catch {
    return reply({ error: "Public knowledge index unavailable. Run the site build before deploying." }, 503);
  }

  // Pull current public GitHub/Boplog project descriptions (cache ~15 minutes).
  // Network failure is nonfatal: the signed, in-repo evidence snapshot remains usable.
  let projectChunks = [];
  if (env.PUBLIC_PROJECTS_DISABLED !== "true") {
    projectChunks = (await getPublicProjectIndex()).chunks;
  }
  const history = cleanHistory(input.history);
  const hits = retrieveForTurn(question, history, [...projectChunks, ...index.chunks], 6);
  if (!hits.length) {
    return reply({
      answer: "The public sources /kvn draws on don't cover that, so I can't confirm or answer it. Try asking about Kevin's projects, open-source contributions, or public opinions.",
      sources: [],
      model: "evidence-only"
    });
  }

  if (provider === "cloudflare") {
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET) {
      return reply({ error: "Free chat setup incomplete. Site owner must configure Turnstile." }, 503);
    }
    if (!(await checkTurnstile(env.TURNSTILE_SECRET, input.turnstileToken, ip, new URL(request.url).hostname))) {
      return reply({ error: "Verification required. Complete the anti-bot check and retry." }, 403);
    }
  }

  const messages = buildMessages(question, history, hits);

  const sources = hits.map((doc) => ({ title: doc.title, url: doc.url, type: doc.type }));
  const FREE_MODEL = freeModel(env);
  if (provider === "cloudflare" && input.stream === true) {
    try {
      if (!env.AI) return reply({ error: "Cloudflare AI binding not configured." }, 503);
      const output = await env.AI.run(FREE_MODEL, shapeInput(FREE_MODEL, messages, {
        max_tokens: MAX_TOKENS, temperature: 0.35, stream: true
      }));
      if (!output || typeof output.getReader !== "function") throw new Error("No readable output");
      return streamAnswer(output, sources, FREE_MODEL, hits);
    } catch {
      return reply({ error: "The free model is unavailable right now, usually because today's free quota is used up. Pick on-device AI (free, runs in your browser) or bring a Groq/OpenRouter key, or try again tomorrow." }, 503);
    }
  }

  let answer;
  let model = FREE_MODEL;
  try {
    if (provider === "cloudflare") {
      if (!env.AI) return reply({ error: "Cloudflare AI binding not configured." }, 503);
      const result = await env.AI.run(FREE_MODEL, shapeInput(FREE_MODEL, messages, {
        max_tokens: MAX_TOKENS, temperature: 0.35
      }));
      answer = answerText(result);
    } else {
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (!apiKey || apiKey.length > 256) return reply({ error: "Bring a valid provider API key." }, 400);
      const config = PROVIDERS[provider];
      const selected = typeof input.model === "string" && /^[\w./:+-]{1,120}$/.test(input.model)
        ? input.model : config.model;
      model = selected;
      // Keys are forwarded only to the chosen allowlisted provider, never persisted or logged.
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "authorization": "Bearer " + apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ model: selected, ...shapeInput(selected, messages, { max_tokens: MAX_TOKENS, temperature: 0.35 }, provider) })
      });
      if (!response.ok) return reply({ error: "Provider returned HTTP " + response.status + ". Check your key/model or quota." }, 502);
      answer = answerText(await response.json());
    }
    if (typeof answer !== "string" || !answer.trim()) throw new Error("Empty output");
    answer = autoCite(answer, hits);
  } catch {
    return reply({ error: "The model is unavailable right now. If you're on the free model, today's free quota may be used up: pick on-device AI or bring a Groq/OpenRouter key, or try again tomorrow." }, 503);
  }

  return reply({
    answer: answer.trim(),
    model,
    sources
  });
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/status") {
      return reply({
        defaultModel: freeModel(env),
        turnstileSiteKey: env.TURNSTILE_SECRET ? (env.TURNSTILE_SITE_KEY || "") : "",
        freeConfigured: Boolean(env.AI && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY),
        byoProviders: Object.keys(PROVIDERS)
      });
    }
    if (pathname === "/api/public-projects") {
      if (request.method !== "GET") return reply({ error: "GET required." }, 405);
      const snapshot = await getPublicProjectIndex();
      return reply({
        generatedAt: snapshot.generatedAt,
        chunks: snapshot.chunks
      });
    }
    if (pathname === "/api/chat") {
      if (request.method !== "POST") return reply({ error: "POST required." }, 405);
      return chat(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
