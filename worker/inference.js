// Model-specific request shaping and answer extraction.
//
// Workers AI chat models now answer in the OpenAI shape (choices[0].message.content, streamed
// as chat.completion.chunk deltas). Several of them reason before answering, and reasoning
// tokens count against max_tokens: with thinking on, a 350-token budget often ended before
// any visible answer. Every model we serve therefore gets an explicit "no visible reasoning"
// setting, measured per model in eval/ (see eval/README.md).

const PROFILES = [
  // Qwen3 hybrid models: the in-prompt soft switch is the only control Workers AI honors for
  // qwen3-30b-a3b (chat_template_kwargs returned the answer in the reasoning field).
  { match: /qwen3-30b-a3b/, suffix: " /no_think" },
  { match: /qwen3\.8|qwen3\.\d|qwen-3/, input: { chat_template_kwargs: { enable_thinking: false } } },
  { match: /gpt-oss/, input: { reasoning_effort: "low" } },
  { match: /gemma-4|glm-4\.7|glm-5|nemotron-3|deepseek-v4|kimi-k2/, input: { chat_template_kwargs: { enable_thinking: false } } }
];

export function profileFor(model) {
  const id = String(model || "").toLowerCase();
  return PROFILES.find((profile) => profile.match.test(id)) || {};
}

// Visitor-key providers speak OpenAI-style APIs that reject Workers AI's chat_template_kwargs
// (Groq answers HTTP 400), so they get their own switches.
const BYO = {
  groq: (id) => /qwen/.test(id) ? { reasoning_effort: "none" } : /gpt-oss/.test(id) ? { reasoning_effort: "low" } : {},
  // OpenRouter's unified reasoning setting; models without reasoning ignore it.
  openrouter: () => ({ reasoning: { effort: "low", exclude: true } })
};

// Build the provider input for a chat model: messages plus the model's no-reasoning switch.
export function shapeInput(model, messages, options = {}, provider = "cloudflare") {
  const profile = provider === "cloudflare" ? profileFor(model) : {};
  const shaped = messages.map((message) => ({ ...message }));
  if (profile.suffix) {
    const last = shaped.findLastIndex((message) => message.role === "user");
    if (last >= 0) shaped[last].content += profile.suffix;
  }
  const extra = provider === "cloudflare" ? profile.input || {} : (BYO[provider]?.(String(model || "").toLowerCase()) || {});
  return { messages: shaped, ...options, ...extra };
}

// Remove reasoning that some models inline into the visible text.
// gpt-oss cites as 【3】 or 【3†L1-L4】; the site links plain [3].
export function normalizeCitations(text) {
  return String(text ?? "").replace(/【(\d{1,2})(?:†[^】]*)?】/g, "[$1]").replace(/\[(\d{1,2})†[^\]\n]*\]/g, "[$1]")
    .replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})+)\]/g, (_, list) => list.split(",").map((n) => "[" + n.trim() + "]").join(""));
}

export function stripReasoning(text) {
  let out = String(text ?? "");
  // Harmony-format leak (gpt-oss): "analysis: …<|end|><|start|>assistantfinal: answer<|end|>…".
  if (/assistant\s*final/i.test(out)) {
    const finals = out.split(/assistant\s*final\s*:?/i).slice(1).map((part) => part.replace(/<\|[a-z_]+\|>/gi, "").trim()).filter(Boolean);
    out = finals.at(-1) || "";
  }
  return normalizeCitations(out
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .replace(/<\|channel\|>analysis[\s\S]*?<\|channel\|>final<\|message\|>/gi, "")
    .replace(/<\|(?:end|return|start|message|channel)\|>/gi, ""))
    .trim();
}

// Final answer text from any supported result shape (Workers AI legacy, OpenAI-compatible).
export function answerText(result) {
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string") return stripReasoning(content);
  if (result?.response !== undefined && result?.response !== null) return stripReasoning(String(result.response));
  return "";
}

// Visible text of one streamed event. Workers AI sends both an OpenAI delta and a legacy
// `response` field; the legacy field is a JSON number for digit tokens ("8", "5"), which
// silently dropped every digit (QN85B -> QNB, [1] -> []). Prefer the string delta.
export function deltaText(event) {
  const delta = event?.choices?.[0]?.delta;
  if (delta && typeof delta.content === "string") return delta.content;
  if (delta && ("reasoning" in delta || "reasoning_content" in delta)) return "";
  if (event?.response !== undefined && event?.response !== null) return String(event.response);
  return "";
}

// Turn an upstream SSE byte stream (Workers AI or OpenAI-compatible) into our own minimal
// SSE: `data: {"delta":"..."}` frames carrying visible answer text only, reasoning dropped,
// and a leading <think> block suppressed if a model emits one inline.
export function normalizeStream(upstream) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  let thinking = null; // null = unknown yet, true = inside an inline <think> block
  let pending = "";
  function emitText(controller, text) {
    if (!text) return;
    if (thinking === null) {
      pending += text;
      const trimmed = pending.trimStart();
      if (!trimmed) return;
      if ("<think>".startsWith(trimmed.slice(0, 7)) && trimmed.length < 7) return;
      if (trimmed.startsWith("<think>")) { thinking = true; text = trimmed.slice(7); pending = ""; }
      else { thinking = false; text = pending; pending = ""; }
    }
    if (thinking === true) {
      const end = text.indexOf("</think>");
      if (end < 0) return;
      thinking = false;
      text = text.slice(end + 8);
    }
    text = text.replace(/【/g, "[").replace(/】/g, "]");
    if (text) controller.enqueue(encoder.encode("data: " + JSON.stringify({ delta: text }) + "\n\n"));
  }
  function frame(controller, raw) {
    const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    emitText(controller, deltaText(event));
  }
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += typeof value === "string" ? value : decoder.decode(value, { stream: true });
          buffered = buffered.replace(/\r\n/g, "\n");
          let index;
          while ((index = buffered.indexOf("\n\n")) !== -1) {
            frame(controller, buffered.slice(0, index));
            buffered = buffered.slice(index + 2);
          }
        }
        buffered += decoder.decode();
        if (buffered.trim()) frame(controller, buffered);
        // A short answer that never resolved the <think> check is still an answer.
        if (thinking === null && pending.trim()) controller.enqueue(encoder.encode("data: " + JSON.stringify({ delta: pending }) + "\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    }
  });
}
