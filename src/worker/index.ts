import Anthropic from "@anthropic-ai/sdk";
import { parseQuote, type Media } from "../core/parse";
import { scanRecord } from "../core/redact";
import { validateQuote, isBlocked } from "../core/validate";
import { checkFairness, priorBand, type Band } from "../core/fairness";
import { computeIsde, ISDE_CONDITIONS } from "../core/isde";
import { aggregate, K_MIN, INSTALLERS_MIN } from "../core/aggregate";
import { recordEvent, activeExperiments, weeklyLearning, latestReport } from "./learning";
import { handleChat, handleChatFeedback, handleContact, handleEmail, handleFaq, dailySupport, weeklySupport } from "./support";
import { seedTariffs, tariffsFromCbs, type Tariffs } from "../core/savings";

const WEEKLY_CRON = "0 7 * * 1";
const DAILY_CRON = "30 4 * * *";
const CBS = "https://opendata.cbs.nl/ODataApi/OData/85592NED";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  INSTALLER_HMAC_KEY: string;
  DAILY_CAP_USD: string;
  CONSENT_VERSION: string;
  ALLOWED_ORIGIN: string;
  AUTO_SHIP_VARIANTS: string;
  REPORT_TOKEN?: string;
  REPORT_WEBHOOK_URL?: string;
  // Support function
  SUPPORT_FROM: string;            // sender address, e.g. hallo@kloptmijnofferte.nl (Brevo-verified)
  SUPPORT_DAILY_CAP_USD?: string;  // model spend cap for chat and mail answers
  AUTO_SHIP_FAQ?: string;          // "true": learned FAQ entries go live after the checks
  BREVO_API_KEY?: string;          // secret
  OWNER_EMAIL?: string;            // secret: where escalations go (verified Email Routing destination)
}

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, Media["media_type"]> = {
  "application/pdf": "application/pdf", "image/jpeg": "image/jpeg", "image/png": "image/png",
};

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (data: BufferSource) => hex(await crypto.subtle.digest("SHA-256", data));
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const code = () => [...crypto.getRandomValues(new Uint8Array(6))].map((x) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[x % 31]).join("");
const today = () => new Date().toISOString().slice(0, 10);

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN,
      "cache-control": "no-store",
    },
  });
}

async function spentToday(env: Env) {
  const row = await env.DB.prepare("SELECT usd FROM spend WHERE day = ?").bind(today()).first<{ usd: number }>();
  return row?.usd ?? 0;
}
async function addSpend(env: Env, usd: number) {
  await env.DB.prepare("INSERT INTO spend(day, usd, checks) VALUES(?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, checks = checks + 1")
    .bind(today(), usd).run();
}

async function ownBand(env: Env): Promise<Band> {
  const { results } = await env.DB.prepare("SELECT 'hybrid' AS cell, total_incl_vat, installer_key, uploader_key FROM quotes WHERE product = 'hybrid_heat_pump' AND status = 'ok'")
    .all<{ cell: string; total_incl_vat: number; installer_key: string | null; uploader_key: string }>();
  const [cell] = aggregate(results);
  return cell ? { p25: cell.p25, median: cell.median, p75: cell.p75, n: cell.n, source: "eigen_data" } : priorBand();
}

async function handleCheck(req: Request, env: Env): Promise<Response> {
  if (Number(env.DAILY_CAP_USD) <= (await spentToday(env)))
    return json(env, { error: "daglimiet", message: "Het is vandaag erg druk. Probeer het morgen opnieuw." }, 503);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json(env, { error: "geen_bestand", message: "Kies een offerte (pdf, jpg of png)." }, 400);
  const media_type = TYPES[file.type];
  if (!media_type) return json(env, { error: "bestandstype", message: "Alleen pdf, jpg of png." }, 400);
  if (file.size > MAX_BYTES) return json(env, { error: "te_groot", message: "Maximaal 10 MB." }, 400);
  const reuse = form.get("consent_reuse") === "on";
  const pc4Input = String(form.get("pc4") ?? "").match(/^[1-9]\d{3}$/)?.[0];

  // The file lives only in memory for this request and is never written to storage.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploader_key = await sha256(bytes);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const parsed = await parseQuote(client, { data: toBase64(bytes), media_type });
  await addSpend(env, parsed.cost_usd);

  if (parsed.not_a_quote) return json(env, { error: "geen_offerte", message: "Dit lijkt geen offerte voor een warmtepomp." }, 422);
  if (!parsed.quote) return json(env, { error: "niet_gelezen", message: "We konden deze offerte niet goed lezen. Probeer een scherpere foto of de pdf." }, 422);

  const q = { ...parsed.quote, pc4: parsed.quote.pc4 ?? pc4Input };
  const issues = validateQuote(q);
  const purchase_date = q.signed_date ?? q.quote_date;
  const result = {
    quote: { ...q, installer_kvk: undefined },
    fairness: checkFairness(q, await ownBand(env)),
    subsidy: /^\d{4}-\d{2}-\d{2}$/.test(purchase_date) ? computeIsde({ ...q, purchase_date }) : null,
    subsidy_conditions: ISDE_CONDITIONS,
    issues: issues.filter((i) => i.severity !== "info" || i.code === "no_meldcode"),
    stored: false,
    check_code: null as string | null,
  };

  if (reuse && !isBlocked(issues)) {
    const { installer_kvk, ...record } = q;
    const hits = scanRecord(record);
    if (hits.length === 0) {
      const check_code = code();
      const now = new Date().toISOString();
      const status = issues.some((i) => i.severity === "review") ? "review" : "ok";
      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO quotes(id, created_at, created_month, product, pc4, total_incl_vat, record, installer_key, uploader_key, check_code_hash, consent_version, model, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), now, now.slice(0, 7), q.product, q.pc4 ?? null, q.total_incl_vat, JSON.stringify(record),
        installer_kvk ? await hmac(env.INSTALLER_HMAC_KEY, installer_kvk) : null,
        uploader_key, await sha256(new TextEncoder().encode(check_code)), env.CONSENT_VERSION, parsed.model, status,
      ).run();
      if (ins.meta.changes === 1) { result.stored = true; result.check_code = check_code; }
    }
  }
  return json(env, result);
}

async function handleWithdraw(req: Request, env: Env) {
  const { code: c } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!c) return json(env, { error: "geen_code" }, 400);
  const res = await env.DB.prepare("DELETE FROM quotes WHERE check_code_hash = ? AND created_at >= ?")
    .bind(await sha256(new TextEncoder().encode(c.trim().toUpperCase())), new Date(Date.now() - 30 * 864e5).toISOString()).run();
  return json(env, { removed: res.meta.changes === 1 });
}

async function handleSignup(req: Request, env: Env) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(env, { error: "email" }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO signups(email, created_at, confirm_token) VALUES(?, ?, ?)")
    .bind(email.toLowerCase(), new Date().toISOString(), crypto.randomUUID()).run();
  // TODO: send double opt-in mail via Brevo once the account exists.
  return json(env, { ok: true });
}

async function handlePrices(env: Env) {
  const band = await ownBand(env);
  return json(env, { hybrid_heat_pump: band, rules: { k_min: K_MIN, installers_min: INSTALLERS_MIN } });
}

/** Monthly: pull the latest CBS consumer energy tariffs (incl. VAT) into D1. */
async function refreshTariffs(env: Env) {
  const props = (await (await fetch(`${CBS}/DataProperties?$format=json`)).json()) as { value: any[] };
  const rows = (await (await fetch(`${CBS}/TypedDataSet?$format=json&$top=1&$orderby=Perioden desc&$filter=substringof('MM',Perioden)`)).json()) as { value: any[] };
  const row = rows.value?.[0];
  if (!row) return;
  const period = String(row.Perioden).replace(/^(\d{4})MM(\d{2}).*$/, "$1-$2");
  const t = tariffsFromCbs(props.value, row, period);
  if (!t) { console.error("CBS columns not recognised"); return; }
  await env.DB.prepare("INSERT OR REPLACE INTO tariffs(period, gas_per_m3, electricity_per_kwh, fetched_at) VALUES(?, ?, ?, ?)")
    .bind(t.as_of, t.gas_per_m3, t.electricity_per_kwh, new Date().toISOString()).run();
}

async function handleTariffs(env: Env) {
  const r = await env.DB.prepare("SELECT period, gas_per_m3, electricity_per_kwh FROM tariffs ORDER BY period DESC LIMIT 1")
    .first<{ period: string; gas_per_m3: number; electricity_per_kwh: number }>();
  const t: Tariffs = r ? { gas_per_m3: r.gas_per_m3, electricity_per_kwh: r.electricity_per_kwh, as_of: r.period, source: seedTariffs().source } : seedTariffs();
  return new Response(JSON.stringify(t), { headers: { "content-type": "application/json", "access-control-allow-origin": env.ALLOWED_ORIGIN, "cache-control": "public, max-age=86400" } });
}

/** Weekly: the A/B report and the support report go out together, as one report and one webhook call. */
async function weeklyWithSupport(env: Env) {
  const support = await weeklySupport(env).catch((e) => ({ error: e instanceof Error ? e.message : "unknown" }));
  await weeklyLearning(env, { support });
}

export default {
  async scheduled(c: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (c.cron === DAILY_CRON) return ctx.waitUntil(dailySupport(env));
    if (c.cron === WEEKLY_CRON) return ctx.waitUntil(weeklyWithSupport(env));
    ctx.waitUntil(refreshTariffs(env));
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    try { await handleEmail(message, env); }
    catch (e) {
      console.error("email handler", e instanceof Error ? e.message : "unknown");
      if (env.OWNER_EMAIL) await message.forward(env.OWNER_EMAIL).catch(() => {});
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS")
      return new Response(null, { headers: { "access-control-allow-origin": env.ALLOWED_ORIGIN, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
    try {
      if (req.method === "POST" && pathname === "/api/check") return await handleCheck(req, env);
      if (req.method === "POST" && pathname === "/api/withdraw") return await handleWithdraw(req, env);
      if (req.method === "POST" && pathname === "/api/signup") return await handleSignup(req, env);
      if (req.method === "GET" && pathname === "/api/prices") return await handlePrices(env);
      if (req.method === "GET" && pathname === "/api/tarieven") return await handleTariffs(env);
      if (req.method === "POST" && pathname === "/api/e") { await recordEvent(req, env); return new Response(null, { status: 204, headers: { "access-control-allow-origin": env.ALLOWED_ORIGIN } }); }
      if (req.method === "POST" && pathname === "/api/chat") return await handleChat(req, env);
      if (req.method === "POST" && pathname === "/api/chat/feedback") return await handleChatFeedback(req, env);
      if (req.method === "POST" && pathname === "/api/contact") return await handleContact(req, env);
      if (req.method === "GET" && pathname === "/api/faq") return await handleFaq(env);
      if (req.method === "GET" && pathname === "/api/experiments") return json(env, await activeExperiments(env));
      if (req.method === "GET" && pathname === "/api/report") {
        if (!env.REPORT_TOKEN || new URL(req.url).searchParams.get("token") !== env.REPORT_TOKEN) return json(env, { error: "forbidden" }, 403);
        const r = await latestReport(env);
        return json(env, r ? JSON.parse(r.body) : null);
      }
      return json(env, { error: "not_found" }, 404);
    } catch (e) {
      console.error(e instanceof Error ? e.message : "unknown error");
      return json(env, { error: "server", message: "Er ging iets mis. Probeer het later opnieuw." }, 500);
    }
  },
};
