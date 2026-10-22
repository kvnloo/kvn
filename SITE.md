# /kvn public chat

This is a first working slice of a public, evidence-grounded chat website for /kvn.

The public website is a static frontend served by one Cloudflare Worker. The
Worker handles chat and uses a Workers AI binding with Qwen3-30B-A3B for the
default free model. No visitor account or API key is needed for free chat.

## Start, test and deploy

Requires Node.js 20+, a free Cloudflare account, and Wrangler authentication.

1. Run: npm run test:site
2. Run: npm run build:site
3. Run: npx wrangler login
4. Run: npm run deploy:site
5. Open the workers.dev URL printed by Wrangler.

The deployment command regenerates site/knowledge.json before uploading assets.
No third-party LLM key is needed: wrangler.jsonc defines the AI and static asset
bindings plus an anonymous request-rate limiter. The free model stops serving
when Cloudflare's daily Workers AI allocation is used up **on the Workers Free
plan**. On Workers Paid, overage is billed unless you enforce an additional
budget cap; this app does not implement a global hard quota. Deploy on a Free
plan to guarantee the free allocation stops rather than charging.

The site is not deployed by a PR alone. A Cloudflare account must authorize
the first deployment. Optionally configure a custom domain afterward.

## Sources and refresh

The site reuses ENTRY.md, OPINIONS.md, TOOLS.md, VOICE.md, and every publicly
authorized raw record listed in content/MANIFEST.json. The deterministic index
builder checks the SHA-256 of each raw record and creates section-sized chunks
with canonical public source links.

On each update to the knowledge files, run npm run deploy:site to publish the
new snapshot. No new accounts or private materials may be added automatically.
GitHub, X and Boplog data should enter through the existing GROK_BOT.md public
refresh rules; the chat runtime does not crawl arbitrary websites.

## Bring your own model

Visitors may select Groq or OpenRouter and paste a key in the browser. The
Worker proxies their request to an allowlisted provider endpoint. Keys are
not written to localStorage, cookies, server logs or a database by this code.
They exist in the user's tab and in transit through the Worker to the provider.
The browser may select a model ID accepted by the chosen provider; any
provider-side billing is on the visitor's account. Do not submit a key that
cannot be sent through this site's backend.

## Abuse, privacy and limitations

- The Worker enforces a small approximate per-IP rate limit (5 requests/minute)
  via the Cloudflare Rate Limiting binding. People sharing an IP can collide.
- For more protection, configure a free Cloudflare Turnstile widget: add the
  public TURNSTILE_SITE_KEY variable in wrangler.jsonc under vars, then run
  npx wrangler secret put TURNSTILE_SECRET. The Worker validates each free-chat
  token server-side. Configure both values together.
- Model output is text, never injected as HTML. External URL fetching and
  arbitrary BYO inference endpoints are intentionally disallowed.
- Questions, public evidence and BYO API keys transit through the selected
  inference provider. Provider data practices and quotas may differ.
- The Worker does not store conversation history, but the site keeps up to
  four preceding turns in the current tab for context.
- This is not a private messaging channel, and the AI is not Kevin himself.
- Citation links are attached by the retrieval layer; citations appearing in
  generated prose are model-generated and should be checked against those links.
- Lexical retrieval is an initial baseline, not embeddings or live GitHub search.
  Answer coverage is limited to the currently verified public snapshot.

Future improvements: stream answers; add WebLLM browser-local fallback;
expand authorized public-source sync; add evals for evidence accuracy;
introduce site analytics only with explicit privacy guardrails.
