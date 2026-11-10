import { askLocally } from "./local-llm.js";
import { renderMarkdown } from "./render.js";
import { parseChatResponse } from "./sse.js";
import { askHermes, connectHermes, parsePairing } from "./hermes.js";
const $ = (selector) => document.querySelector(selector);
const form = $("#ask");
const thread = $("#thread");
const sourcesView = $("#sources");
const input = $("#question");
const provider = $("#provider");
const apiKey = $("#api-key");
const model = $("#model");
const byoFields = $("#byo-fields");
const send = $("#send");
const hermesFields = $("#hermes-fields");
const pairing = $("#pairing");
const hermesState = $("#hermes-state");
document.querySelectorAll(".origin").forEach((node) => { node.textContent = location.origin; });
const status = $("#status");
const state = { turns: [], busy: false, turnstileToken: "", turnstileWidget: null };

function setProvider() {
  const isByo = provider.value === "groq" || provider.value === "openrouter";
  byoFields.hidden = !isByo;
  hermesFields.hidden = provider.value !== "hermes";
  state.turns = []; // A new provider starts a new context; earlier turns are not shared with it.
  model.value = provider.value === "groq" ? "qwen/qwen3.8-27b" : "openrouter/free";
  apiKey.value = "";
}
provider.addEventListener("change", setProvider);
setProvider();

// Every tool request from the visitor's Hermes is shown to them; nothing is auto-approved.
function askPermission({ params, choose }) {
  const dialog = $("#permission");
  $("#permission-what").textContent = params?.toolCall?.title || params?.toolCall?.kind || "a tool";
  const options = $("#permission-options");
  options.replaceChildren(...(params?.options || []).map((option) => {
    const button = document.createElement("button");
    button.value = option.optionId;
    button.textContent = option.name;
    return button;
  }));
  const offered = new Set((params?.options || []).map((option) => option.optionId));
  dialog.onclose = () => { dialog.onclose = null; choose(offered.has(dialog.returnValue) ? dialog.returnValue : null); };
  dialog.returnValue = "";
  dialog.showModal();
}

async function connect() {
  const pair = parsePairing(pairing.value);
  if (!pair) { hermesState.textContent = "That is not a pairing code. The bridge prints one like 43190.Ab3…"; return; }
  hermesState.textContent = "connecting…";
  try {
    const { agent } = await connectHermes(pair, askPermission, () => {
      const dialog = $("#permission");
      if (dialog.open) dialog.close(""); // pending request is denied, never left dangling
      hermesState.textContent = "disconnected · start the bridge again and paste the new code";
      status.textContent = "your Hermes · disconnected";
    });
    hermesState.textContent = "connected to " + (agent?.title || agent?.name || "your agent") + (agent?.version ? " " + agent.version : "");
    status.textContent = "your Hermes · connected";
  } catch (error) {
    hermesState.textContent = error.message;
  }
}
$("#hermes-connect").addEventListener("click", connect);
const hashPair = /acp=([\w.-]+)/.exec(location.hash)?.[1];
if (hashPair) {
  history.replaceState(null, "", location.pathname);
  pairing.value = hashPair;
  provider.value = "hermes";
  setProvider();
  connect();
}

function addMessage(role, value) {
  const bubble = document.createElement("article");
  bubble.className = "bubble " + role;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = role === "user" ? "visitor" : "/kvn · AI";
  const content = document.createElement("div");
  content.className = "message";
  content.textContent = value; // Visitor text and status lines are plain text.
  bubble.append(label, content);
  thread.append(bubble);
  thread.scrollTop = thread.scrollHeight;
  return { bubble, content };
}

// Model output: safe Markdown subset built as DOM nodes; [n] markers link to sources.
function showAnswer(content, answer, refs) {
  renderMarkdown(document, content, answer, refs);
}

function answerSources(bubble, refs) {
  const usable = refs.map((ref, index) => ({ ref, index })).filter(({ ref }) => /^https:\/\//.test(ref.url));
  if (!usable.length) return;
  const list = document.createElement("ol");
  list.className = "answer-sources";
  list.setAttribute("aria-label", "Sources for this answer");
  for (const { ref, index } of usable) {
    const item = document.createElement("li");
    item.value = index + 1;
    item.setAttribute("value", String(index + 1));
    const link = document.createElement("a");
    link.href = ref.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = sourceLabel(ref);
    item.append(link);
    list.append(item);
  }
  bubble.append(list);
}

// Where a source lives, so two sources with one title ("warp" in TOOLS.md and on Boplog) differ.
function sourceLabel(ref) {
  const title = ref.title || new URL(ref.url).hostname;
  if (ref.type === "public-project") return title + " · Boplog";
  const file = /\/blob\/[^/]+\/(.+)$/.exec(ref.url || "")?.[1];
  if (file && file !== title) return title + " · " + file.replace(/^content\//, "");
  return title;
}

function renderSources(refs) {
  sourcesView.replaceChildren();
  if (!refs.length) {
    const empty = document.createElement("span");
    empty.textContent = "No public evidence found for that question.";
    sourcesView.append(empty);
    return;
  }
  refs.forEach((ref, index) => {
    if (!/^https:\/\//.test(ref.url)) return;
    const link = document.createElement("a");
    link.href = ref.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "[" + (index + 1) + "] " + sourceLabel(ref) + " ↗";
    sourcesView.append(link);
  });
}

function resetVerification() {
  state.turnstileToken = "";
  if (state.turnstileWidget !== null && window.turnstile) {
    window.turnstile.reset(state.turnstileWidget);
  }
}

async function submit(question) {
  if (state.busy || !question.trim()) return;
  state.busy = true;
  send.disabled = true;
  input.value = "";
  const userQuestion = question.trim();
  addMessage("user", userQuestion);
  const waiting = addMessage("assistant", "retrieving public evidence…");
  try {
    let data;
    if (provider.value === "hermes") {
      data = await askHermes(userQuestion, state.turns.slice(-4), (answer, refs) => {
        showAnswer(waiting.content, answer, refs);
        thread.scrollTop = thread.scrollHeight;
      });
    } else if (provider.value === "browser") {
      data = await askLocally(
        userQuestion, state.turns.slice(-4),
        (answer, refs = []) => {
          showAnswer(waiting.content, answer, refs);
          thread.scrollTop = thread.scrollHeight;
        },
        (message) => { status.textContent = message; }
      );
    } else {
      const payload = {
        question: userQuestion, history: state.turns.slice(-4),
        provider: provider.value, turnstileToken: state.turnstileToken,
        stream: provider.value === "cloudflare"
      };
      if (provider.value === "groq" || provider.value === "openrouter") {
        payload.apiKey = apiKey.value;
        payload.model = model.value;
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      data = await parseChatResponse(response, ({ answer, sources }) => {
        if (answer) showAnswer(waiting.content, answer, sources || []);
        thread.scrollTop = thread.scrollHeight;
      });
    }
    const refs = Array.isArray(data.sources) ? data.sources : [];
    showAnswer(waiting.content, data.answer, refs);
    renderSources(refs);
    answerSources(waiting.bubble, refs);
    state.turns.push({ role: "user", content: userQuestion }, { role: "assistant", content: data.answer.slice(0, 900) });
    state.turns = state.turns.slice(-8);
    status.textContent = "answered via " + data.model;
  } catch (error) {
    input.value = userQuestion;
    waiting.content.textContent = error.message;
    status.textContent = "temporarily unavailable";
  } finally {
    resetVerification();
    send.disabled = false;
    state.busy = false;
    thread.scrollTop = thread.scrollHeight;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(input.value);
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit(input.value);
  }
});
document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => submit(button.dataset.question));
});

async function init() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error();
    const data = await response.json();
    status.textContent = data.freeConfigured ? "online · quota-limited free tier" : "free chat setup pending";
    if (data.turnstileSiteKey) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => {
        state.turnstileWidget = window.turnstile.render("#turnstile", {
          sitekey: data.turnstileSiteKey,
          theme: "dark",
          callback: (token) => { state.turnstileToken = token; },
          "expired-callback": () => { state.turnstileToken = ""; }
        });
      };
      document.head.append(script);
    }
  } catch {
    status.textContent = "backend not connected";
  }
}
init();
