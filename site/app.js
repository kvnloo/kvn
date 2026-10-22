import { askLocally } from "./local-llm.js";
import { parseChatResponse } from "./sse.js";
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
const status = $("#status");
const state = { turns: [], busy: false, turnstileToken: "", turnstileWidget: null };

function setProvider() {
  const isByo = provider.value === "groq" || provider.value === "openrouter";
  byoFields.hidden = !isByo;
  model.value = provider.value === "groq" ? "openai/gpt-oss-120b" : "openrouter/free";
  apiKey.value = "";
}
provider.addEventListener("change", setProvider);
setProvider();

function addMessage(role, value, refs = []) {
  const bubble = document.createElement("article");
  bubble.className = "bubble " + role;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = role === "user" ? "visitor" : "/kvn · AI";
  const content = document.createElement("div");
  content.className = "message";
  content.textContent = value; // Never render model output as HTML.
  bubble.append(label, content);
  if (refs.length) {
    const links = document.createElement("div");
    links.className = "answer-sources";
    refs.forEach((ref, index) => {
      if (!/^https:\/\//.test(ref.url)) return;
      const link = document.createElement("a");
      link.href = ref.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "source " + (index + 1) + " ↗";
      links.append(link);
    });
    bubble.append(links);
  }
  thread.append(bubble);
  thread.scrollTop = thread.scrollHeight;
  return { bubble, content };
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
    link.textContent = "[" + (index + 1) + "] " + ref.title + " ↗";
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
    if (provider.value === "browser") {
      data = await askLocally(
        userQuestion, state.turns.slice(-4),
        (answer) => {
          waiting.content.textContent = answer;
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
      data = await parseChatResponse(response, ({ answer }) => {
        if (answer) waiting.content.textContent = answer;
        thread.scrollTop = thread.scrollHeight;
      });
    }
    waiting.content.textContent = data.answer;
    renderSources(Array.isArray(data.sources) ? data.sources : []);
    if (Array.isArray(data.sources) && data.sources.length) {
      const citations = document.createElement("div");
      citations.className = "answer-sources";
      data.sources.forEach((source, index) => {
        if (!/^https:\/\//.test(source.url)) return;
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "[" + (index + 1) + "] evidence ↗";
        citations.append(link);
      });
      waiting.bubble.append(citations);
    }
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
