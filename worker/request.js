// Bound bytes while reading, including chunked requests with no Content-Length.
export const MAX_REQUEST_BYTES = 12000;

export async function readChatInput(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    return { error: "Request too large.", status: 413 };
  }
  const reader = request.body?.getReader();
  if (!reader) return { error: "Malformed request.", status: 400 };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        // Do not wait for an untrusted producer's cancellation promise.
        reader.cancel().catch(() => {});
        return { error: "Request too large.", status: 413 };
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return { input: JSON.parse(raw) };
  } catch {
    reader.cancel().catch(() => {});
    return { error: "Malformed request.", status: 400 };
  } finally {
    reader.releaseLock();
  }
}
