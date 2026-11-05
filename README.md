# kloptmijnofferte.nl

Independent "is my quote fair?" check for Dutch homeowners. MVP: hybrid heat pumps.

- `src/core/` pure TypeScript: parser (Claude Haiku 5.5, escalates to Sonnet 5.5), PII redaction, validation, fairness band, ISDE, savings (CBS tariffs), house facts (BAG), aggregation (k>=5 uploaders, >=3 installers), A/B engine and brand lint.
- `src/worker/` Cloudflare Worker API on D1: `/api/check`, `/api/withdraw`, `/api/signup`, `/api/prices`, `/api/tarieven`, `/api/e` (cookieless events), `/api/experiments`, `/api/report`.
- `web/` Astro static site (Cloudflare Pages): `/` quote check, `/bereken` open-data calculator, `/prijzen/hybride-warmtepomp`, `/privacy`.
- `src/core/support/` + `src/worker/support.ts` (Support function): AI live chat `/api/chat` (+ `/api/chat/feedback`), contact form `/api/contact`, inbound mail via Cloudflare Email Routing (`email` handler), public `/api/faq`. Answers come only from the knowledge base in `src/core/support/kb.ts` (Haiku 5.5, own daily cap `SUPPORT_DAILY_CAP_USD`, keyword fallback without a model). Complaints, privacy requests, installer questions and business/press go to `OWNER_EMAIL` with a draft reply; the sender gets a reference and a deadline (5 working days, privacy 1 month). No chat text is stored: only counters and short PII-checked topics; contact messages are wiped after 30 days. Weekly, recurring gaps become new FAQ entries (only from existing facts, brand-linted, `AUTO_SHIP_FAQ`) and unhelpful learned entries are retired.
- Crons: CBS tariffs monthly; learning report weekly (decides A/B tests, promotes winners, proposes and ships a brand-checked challenger when `AUTO_SHIP_VARIANTS=true`).

## Run locally
```
npm install && npx wrangler d1 migrations apply kloptmijnofferte --local
printf 'ANTHROPIC_API_KEY=...\nINSTALLER_HMAC_KEY=dev\n' > .dev.vars
npx wrangler dev --var ALLOWED_ORIGIN:http://localhost:4321
cd web && npm install && PUBLIC_API_BASE=http://localhost:8787 npm run dev
npm test
```

## Deploy (first time)
`npx wrangler d1 create kloptmijnofferte` (EU location), put the id in `wrangler.toml`, apply migrations with `--remote`, set secrets (incl. `BREVO_API_KEY`, `OWNER_EMAIL`), `npx wrangler deploy`, in Email Routing send `hallo@` to this Worker and verify the owner address as a destination, connect `web/` to Cloudflare Pages, route `kloptmijnofferte.nl/api/*` to the Worker.

Data seeds come from the Data and quality thread (`src/core/data/`).
