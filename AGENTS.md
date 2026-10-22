# Agent instructions for /kvn

This is a PUBLIC snapshot and public chat website, not a source of private
personal data. Follow README.md, ENTRY.md, GROK_BOT.md, and SITE.md.

## Current deployment handoff

When asked to launch /kvn through Cloudflare CLI:

1. Read HERMES_DEPLOY.md completely.
2. Validate the existing PR branch and CI; use the actual live revision.
3. Check existing Cloudflare Workers and Free plan before creating anything.
4. Deploy the existing Worker with Wrangler, not a parallel implementation.
5. Protect free AI with hostname-bound Turnstile before publicizing.
6. Run remote smoke checks and a real browser query with citations.
7. Return the URL and proof of working behavior, or the exact blockers.
8. Do not upgrade, incur paid overages, expose secrets, import private data,
   delete existing Workers, or merge a PR without explicit authorization.

Project checks: npm run check:site
Post-deploy checks: npm run smoke:site -- https://REAL-WORKER-URL
