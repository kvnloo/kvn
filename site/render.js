// Render model output as a safe Markdown subset by building DOM nodes (never innerHTML).
// Supports paragraphs, "-"/"*"/"1." lists, **bold**, *italic*, `code`, https links, and
// [n] citation markers, which become links to the answer's nth source.

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[(\d{1,2})\](?!\()|\[([^\]\n]{1,120})\]\((https:\/\/[^\s)]+)\)|https:\/\/[^\s)<>\]]+[^\s)<>\].,;:!?'"]|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

function safeHref(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function link(doc, href, text, className) {
  const a = doc.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  if (className) a.className = className;
  return a;
}

export function renderInline(doc, parent, text, sources = []) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.append(doc.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = doc.createElement("strong");
      renderInline(doc, strong, token.slice(2, -2), sources);
      parent.append(strong);
    } else if (token.startsWith("`")) {
      const code = doc.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (match[2]) {
      const n = Number(match[2]);
      const source = sources[n - 1];
      const href = source && safeHref(source.url);
      if (href) {
        const a = link(doc, href, String(n), "cite");
        a.title = source.title || "source " + n;
        a.setAttribute("aria-label", "source " + n + ": " + (source.title || ""));
        parent.append(a);
      } else {
        parent.append(doc.createTextNode(token));
      }
    } else if (match[3]) {
      const href = safeHref(match[4]);
      parent.append(href ? link(doc, href, match[3]) : doc.createTextNode(match[3]));
    } else if (token.startsWith("https://")) {
      const href = safeHref(token);
      parent.append(href ? link(doc, href, token.replace(/^https:\/\//, "")) : doc.createTextNode(token));
    } else {
      const em = doc.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.append(em);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
}

export function renderMarkdown(doc, container, text, sources = []) {
  container.replaceChildren();
  // gpt-oss style citations (【3】, [3†L1-L4]) become plain [3].
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/【(\d{1,2})(?:†[^】]*)?】/g, "[$1]").replace(/\[(\d{1,2})†[^\]\n]*\]/g, "[$1]")
    .replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})+)\]/g, (_, list) => list.split(",").map((n) => "[" + n.trim() + "]").join("")).split("\n");
  let list = null;
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      const p = doc.createElement("p");
      renderInline(doc, p, paragraph.join(" "), sources);
      container.append(p);
      paragraph = [];
    }
  };
  for (const line of lines) {
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (item) {
      flush();
      const ordered = Boolean(item[1]);
      if (!list || (list.tagName === "OL") !== ordered) {
        list = doc.createElement(ordered ? "ol" : "ul");
        container.append(list);
      }
      const li = doc.createElement("li");
      renderInline(doc, li, item[2], sources);
      list.append(li);
    } else if (heading) {
      flush();
      list = null;
      const strong = doc.createElement("p");
      strong.className = "md-heading";
      renderInline(doc, strong, heading[1], sources);
      container.append(strong);
    } else if (!line.trim()) {
      flush();
      list = null;
    } else {
      if (list && /^\s{2,}\S/.test(line)) {
        renderInline(doc, list.lastElementChild, " " + line.trim(), sources);
        continue;
      }
      list = null;
      paragraph.push(line.trim());
    }
  }
  flush();
}
