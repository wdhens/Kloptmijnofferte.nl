# kloptmijnofferte.nl

Independent "is my quote fair?" check for Dutch homeowners. MVP: hybrid heat pumps.

- `src/core/` pure TypeScript: parser (Claude Haiku 5.5, escalates to Sonnet 5.5), PII redaction, validation, fairness band, ISDE, savings (CBS tariffs), house facts (BAG), aggregation (k>=5 uploaders, >=3 installers), A/B engine and brand lint.
- `src/worker/` Cloudflare Worker API on D1: `/api/check`, `/api/withdraw`, `/api/signup`, `/api/prices`, `/api/tarieven`, `/api/e` (cookieless events), `/api/experiments`, `/api/report`.
- `web/` Astro static site (Cloudflare Pages): `/` quote check, `/bereken` open-data calculator, `/prijzen/hybride-warmtepomp`, `/privacy`.
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
`npx wrangler d1 create kloptmijnofferte` (EU location), put the id in `wrangler.toml`, apply migrations with `--remote`, set secrets, `npx wrangler deploy`, connect `web/` to Cloudflare Pages, route `kloptmijnofferte.nl/api/*` to the Worker.

Data seeds come from the Data and quality thread (`src/core/data/`).
