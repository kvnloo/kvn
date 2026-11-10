// Visitor-side inference: no model prompts or model API keys leave the browser.
// WebLLM (Apache-2.0) downloads weights/libraries from upstream/CDN on first use.
import { buildMessages } from "./prompt.js";
import { autoCite, retrieveForTurn } from "./search.js";

// Ollama instruct-2507 4B scored 9.28/10; it is NOT these WebLLM hybrid weights.
// Exact in-browser model quality/compatibility has not yet been qualified.
// Devices that can't fit the 4B (~3.4 GB of GPU memory) fall back to Qwen3 1.7B (~2 GB).
const MODELS = ["Qwen3-4B-q4f16_1-MLC", "Qwen3-1.7B-q4f16_1-MLC"];
let MODEL = MODELS[0];
const LIBRARY = "https://esm.run/@mlc-ai/web-llm@0.2.86";
let enginePromise = null;
let indexPromise = null;

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch("/knowledge.json").then(async (response) => {
      if (!response.ok) throw new Error("Public evidence index is unavailable.");
      const payload = await response.json();
      if (!Array.isArray(payload.chunks)) throw new Error("Evidence index is malformed.");
      // Public metadata is shared from the same Boplog-backed Worker endpoint.
      // No user's questions are transmitted by this background metadata fetch.
      let extra = [];
      try {
        const projectResponse = await fetch("/api/public-projects");
        if (projectResponse.ok) {
          const projectData = await projectResponse.json();
          if (Array.isArray(projectData.chunks)) extra = projectData.chunks;
        }
      } catch { /* Keep the curated public snapshot when offline. */ }
      return [...extra, ...payload.chunks];
    }).catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

async function loadEngine(onStatus) {
  if (!globalThis.navigator?.gpu) {
    throw new Error("Local AI needs WebGPU. Try Chrome/Edge with WebGPU enabled or choose cloud inference.");
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      onStatus("loading local model · first run downloads weights");
      const { CreateMLCEngine } = await import(LIBRARY);
      let lastError;
      for (const id of MODELS) {
        try {
          const engine = await CreateMLCEngine(id, {
            initProgressCallback: ({ progress, text }) => {
              const percentage = Number.isFinite(progress) ? Math.round(progress * 100) : null;
              onStatus(percentage === null ? (text || "loading local AI") : "loading " + id.split("-q")[0] + " · " + percentage + "%");
            }
          });
          MODEL = id;
          return engine;
        } catch (error) {
          lastError = error; // Usually out of GPU memory: try the smaller model.
        }
      }
      throw lastError;
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

// Pure planning step, shared with eval/: which sources and which messages the local model gets.
// Small on-device models get fewer, shorter sources and the compact rule set.
export function planLocal(question, history, corpus, model = MODEL) {
  const hits = retrieveForTurn(question, history, corpus, 4);
  if (!hits.length) return { hits, messages: null };
  const messages = buildMessages(question, history, hits, { perSource: 700, compact: true });
  // Qwen3 reasons by default; on a small local model that burns the whole token budget.
  if (/qwen3/i.test(model)) messages[messages.length - 1].content += " /no_think";
  return { hits, messages };
}

// Drop an (empty or not) <think> block, even while it is still streaming.
export function visibleAnswer(text) {
  return String(text).replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();
}

export const NO_EVIDENCE = "The public sources /kvn draws on don't cover that, so I can't confirm or answer it. Try asking about Kevin's projects, open-source contributions, or public opinions.";

export async function askLocally(question, history = [], onProgress = () => {}, onStatus = () => {}) {
  const corpus = await loadIndex();
  const { hits, messages } = planLocal(question, history, corpus);
  if (!messages) return { answer: NO_EVIDENCE, sources: [], model: "evidence-only" };
  const engine = await loadEngine(onStatus);
  onStatus("generating in your browser");
  const refs = hits.map((doc) => ({ title: doc.title, url: doc.url, type: doc.type }));
  const stream = await engine.chat.completions.create({
    messages, temperature: 0.35, max_tokens: 500, stream: true,
    // Qwen3 reasons by default; thinking tokens would eat the answer budget.
    extra_body: { enable_thinking: false }
  });
  let answer = "";
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      answer += delta;
      onProgress(visibleAnswer(answer), refs);
    }
  }
  answer = autoCite(visibleAnswer(answer), hits);
  if (!answer.trim()) throw new Error("The local model returned an empty response.");
  return { answer: answer.trim(), model: MODEL + " · in-browser", sources: refs };
}
