# Hermes handoff: launch /kvn on Cloudflare Workers Free

Repo: https://github.com/kvnloo/kvn
PR: https://github.com/kvnloo/kvn/pull/1
Branch: feat/public-chat-free-inference
Runtime: Cloudflare Workers (static assets + Workers AI binding), not GitHub Pages
Free model: @cf/qwen/qwen3-30b-a3b-fp8

Authorized source scope: ENTRY.md, TOOLS.md, OPINIONS.md, VOICE.md and
content/MANIFEST.json. Do not ingest private conversations, repos, messages,
secrets or unrelated accounts.

## Definition of done

- Deploy one workers.dev site from the current PR revision. Do not merge the PR
  unless asked. Inspect existing Cloudflare Workers to prevent duplicates.
- No visitor key required for Cloudflare Workers AI; optional Groq/OpenRouter
  BYOK remains separate.
- Managed Turnstile widget configured for the exact site hostname, token
  verified server-side. Free inference fails closed before setup.
- Confirm Cloudflare Workers Free (not Paid) before deployment. Workers Free
  provides 10,000 AI neurons/day without usage overages; Paid can charge for
  overage. Do not upgrade plans or enable paid fallbacks.
- All local checks, remote smoke, and one real browser chat with citations pass.
- Report URL, commit, plan, token protection, test receipts and blockers;
  never report credentials or Turnstile secrets.

## 1. Authenticate, clone and validate

Requires Node.js 20+, git and a Cloudflare account with Workers, Workers AI
and Turnstile. If using the Cloudflare Turnstile API, obtain an API token with
Account:Turnstile:Edit and the account ID, in addition to Wrangler login.
Use a separate KVN_TURNSTILE_API_TOKEN for widget management; it must not
supersede the Wrangler OAuth login used for Worker secrets/deploy.

~~~bash
git clone https://github.com/kvnloo/kvn.git
cd kvn
git fetch origin feat/public-chat-free-inference
git switch --track origin/feat/public-chat-free-inference
npm run test:site
npm run build:site
npx --yes wrangler@4 deploy --dry-run --outdir /tmp/kvn-cloudflare-build
npx --yes wrangler@4 whoami  # run wrangler login first if not signed in
~~~

If PR #1 is already merged, inspect and deploy its merged revision from main
instead. Never deploy an outdated branch over a newer live Worker.

## 2. First Worker deployment (unannounced)

~~~bash
npm run deploy:site
~~~

Wrangler outputs the real workers.dev URL. Record that exact hostname,
without https://, as KVN_HOSTNAME. This first step stages the static site,
but free /api/chat deliberately returns HTTP 503 until both Turnstile
bindings are set. Do not publicize the URL yet.

## 3. Provision Turnstile widget and secrets

Prefer reusing an appropriate existing widget. Use a Managed Turnstile widget
restricted to the exact workers.dev hostname (or final custom hostname).

Option A: Cloudflare API from CLI (requires jq, a scoped token, account ID,
and environment variable KVN_HOSTNAME). Never hardcode credentials in source,
shell history or output. Export CLOUDFLARE_ACCOUNT_ID,
KVN_TURNSTILE_API_TOKEN, and KVN_HOSTNAME in the Hermes session.

~~~bash
set +x
WIDGET_JSON="$(curl --fail-with-body -sS \
  -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/challenges/widgets" \
  -H "Authorization: Bearer $KVN_TURNSTILE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(node -e 'console.log(JSON.stringify({domains:[process.env.KVN_HOSTNAME],mode:"managed",name:"kvn-public-chat"}))')")"
printf '%s' "$WIDGET_JSON" | jq -e '.success == true' >/dev/null
KVN_TURNSTILE_SITEKEY="$(printf '%s' "$WIDGET_JSON" | jq -r '.result.sitekey')"
KVN_TURNSTILE_SECRET="$(printf '%s' "$WIDGET_JSON" | jq -r '.result.secret')"
test -n "$KVN_TURNSTILE_SITEKEY" && test -n "$KVN_TURNSTILE_SECRET"
printf '%s' "$KVN_TURNSTILE_SITEKEY" | npx --yes wrangler@4 secret put TURNSTILE_SITE_KEY
printf '%s' "$KVN_TURNSTILE_SECRET" | npx --yes wrangler@4 secret put TURNSTILE_SECRET
unset WIDGET_JSON KVN_TURNSTILE_SECRET KVN_TURNSTILE_SITEKEY
~~~

Option B: Cloudflare dashboard -> Turnstile -> Add widget -> Managed ->
enter exact site hostname; then configure both keys via Wrangler interactive
prompts:

~~~bash
npx --yes wrangler@4 secret put TURNSTILE_SITE_KEY
npx --yes wrangler@4 secret put TURNSTILE_SECRET
~~~

Secret put deploys a new Worker version immediately; redeploy fresh code
afterward:

~~~bash
npm run deploy:site
~~~

If using a new custom domain later, allowlist it on the Turnstile widget.
Token validation checks the hostname returned by Siteverify against the
actual request hostname, and tokens expire after five minutes.

## 4. Remote smoke + browser acceptance

~~~bash
npm run smoke:site -- https://ACTUAL-WORKER.ACTUAL-SUBDOMAIN.workers.dev
~~~

Smoke checks cost zero Workers AI tokens: homepage, public index, status,
bad-input rejection, GET guard, and same-origin guard. Then manually in a
browser: verify Turnstile, ask a grounded question such as "What is AODL?",
watch the model respond, click at least one citation, test an unsupported
question, and check mobile layout. No real conversation is with Kevin.

The /api/status freeConfigured flag must be true. Per-IP rate limiting is
approximate, not a hard global spending cap. Free allocation resets at
00:00 UTC. Keep the account on Workers Free.

## 5. Failure and rollback

- 401/403 auth: missing Cloudflare permission or account access. Do not
  bypass authorization or switch to a paid account.
- freeConfigured false: missing AI binding or TURNSTILE_SITE_KEY/SECRET.
- Turnstile 403: wrong hostname, expired token, or incorrect keys.
- Inference 503: model, Workers AI availability or daily quota.
- Missing knowledge.json: run npm run build:site then redeploy.
- Existing Worker: inspect versions using wrangler deployments list; use
  Wrangler rollback where supported. Never delete production blindly.

Receipt must include exact deployed URL, revision, plan verified, successful
commands/CI links, browser verification, source links, and blockers (if any).

Official Cloudflare docs:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/turnstile/get-started/widget-management/api/


## 6. Optional continuous deployment after merging PR #1

A guarded GitHub Actions workflow is in .github/workflows/site-deploy.yml.
It is disabled until the repository variable below is set to true. Once
configured, a successful push to main that changes public sources or site
code redeploys the same Cloudflare Worker, and workflow_dispatch allows
manual reruns. The live Boplog metadata endpoint is already refreshed at
runtime, so Boplog updates alone do not need a rebuild.

With GitHub CLI authorized for kvnloo/kvn and Cloudflare deploy permissions,
set scoped GitHub Actions secrets without printing their values:

~~~bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo kvnloo/kvn
gh secret set CLOUDFLARE_API_TOKEN --repo kvnloo/kvn
gh variable set KVN_SITE_URL --repo kvnloo/kvn --body "https://ACTUAL-WORKER.ACTUAL-SUBDOMAIN.workers.dev"
gh variable set KVN_CLOUDFLARE_DEPLOY_ENABLED --repo kvnloo/kvn --body true
~~~

Only enable the workflow once human review accepts PR #1 and the real
deployment is verified. Use a token scoped to Workers deploy only; it should
not inherit Turnstile widget-management permissions needlessly.
If gh permissions are unavailable, leave the workflow disabled and document
the missing authorization. Never open a second Worker or commit credentials.
