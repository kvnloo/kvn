// "Your Hermes": answer with the visitor's own Hermes over ACP (see acp/README.md).
// Retrieval and citations stay identical to the other providers; only generation moves.
import { AcpClient } from "./acp/acp.js";
import { buildMessages } from "./prompt.js";
import { autoCite, retrieveForTurn } from "./search.js";
import { loadIndex, NO_EVIDENCE } from "./local-llm.js";

// "43190.token" or a pasted "...#acp=43190.token" link.
export function parsePairing(value) {
  const m = String(value || "").trim().match(/^(?:.*acp=)?(\d{2,5})\.([A-Za-z0-9_-]{16,})$/);
  return m ? { port: Number(m[1]), token: m[2] } : null;
}

// One prompt for the agent: ACP takes content blocks, not chat roles.
export function hermesPrompt(question, history, hits) {
  const messages = buildMessages(question, history, hits, { perSource: 1200 });
  return messages.map((m) => (m.role === "user" ? m.content : `[${m.role}]\n${m.content}`)).join("\n\n") +
    "\n\nAnswer from the sources above only; do not run tools or browse.";
}

let client = null;

export async function connectHermes(pairing, onPermission, onClose = () => {}) {
  client?.close();
  const next = new AcpClient(pairing);
  next.addEventListener("permission", (event) => onPermission(event.detail));
  next.addEventListener("close", () => { if (client === next) { client = null; onClose(); } });
  const info = await next.start();
  client = next;
  return info;
}

export const hermesConnected = () => client !== null;

export async function askHermes(question, history, onProgress) {
  if (!client) throw new Error("Connect your Hermes first: run the bridge and paste its pairing code.");
  const hits = retrieveForTurn(question, history, await loadIndex(), 6);
  if (!hits.length) return { answer: NO_EVIDENCE, sources: [], model: "evidence-only" };
  const refs = hits.map((doc) => ({ title: doc.title, url: doc.url, type: doc.type }));
  let answer = "";
  const onUpdate = ({ detail }) => {
    if (detail.sessionUpdate === "agent_message_chunk" && detail.content?.type === "text") {
      answer += detail.content.text;
      onProgress(answer, refs);
    }
  };
  client.addEventListener("update", onUpdate);
  try {
    await client.prompt(hermesPrompt(question, history, hits));
  } finally {
    client.removeEventListener("update", onUpdate);
  }
  if (!answer.trim()) throw new Error("Your Hermes returned an empty response.");
  const name = client.agent?.title || client.agent?.name || "Hermes";
  return { answer: autoCite(answer.trim(), hits), sources: refs, model: name + " · your machine (ACP)" };
}
