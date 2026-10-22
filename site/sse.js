// Parse both Cloudflare SSE and ordinary JSON responses without HTML injection.
export async function parseChatResponse(response, onProgress = () => {}) {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Chat request failed (HTTP " + response.status + ").");
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const result = await response.json();
    if (!result || typeof result.answer !== "string") throw new Error("Invalid chat response.");
    onProgress({ answer: result.answer, sources: result.sources || [], model: result.model || "" });
    return result;
  }
  if (!response.body?.getReader) throw new Error("This browser cannot read streaming responses.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "", answer = "", sources = [], model = "";
  function frame(raw) {
    const lines = raw.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
    const payload = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!payload || payload === "[DONE]") return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    if (event === "sources") {
      sources = Array.isArray(data.sources) ? data.sources : [];
      model = typeof data.model === "string" ? data.model : "";
    } else if (event === "error") {
      throw new Error(data.error || "Streaming inference failed.");
    } else {
      const delta = data.response ?? data.choices?.[0]?.delta?.content ?? "";
      if (typeof delta === "string") answer += delta;
    }
    onProgress({ answer, sources, model });
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      buffered = buffered.replace(/\r\n/g, "\n");
      let index;
      while ((index = buffered.indexOf("\n\n")) !== -1) {
        const raw = buffered.slice(0, index);
        buffered = buffered.slice(index + 2);
        frame(raw);
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) frame(buffered);
  } finally {
    reader.releaseLock();
  }
  if (!answer.trim()) throw new Error("The model returned an empty response.");
  return { answer: answer.trim(), sources, model };
}
