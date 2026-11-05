// Automated learning loop: count funnel events, decide A/B tests weekly, promote winners,
// and propose a new brand-checked challenger with a small model.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXPERIMENTS, FUNNEL, brandLint, bucketOf, claimedSeconds, decide, dropOff, medianFromBuckets, type Step } from "../core/experiments";
import { MODELS, costUsd } from "../core/parse";
import type { Env } from "./index";

const STEPS = new Set<string>(FUNNEL);
const BOT = /bot|crawl|spider|preview|headless|lighthouse/i;

export async function recordEvent(req: Request, env: Env) {
  if (BOT.test(req.headers.get("user-agent") ?? "")) return;
  const b = (await req.json().catch(() => ({}))) as { step?: string; path?: string; exp?: string; variant?: string; secs?: number };
  if (!b.step || !STEPS.has(b.step)) return;
  const path = (b.path ?? "/").slice(0, 64), exp = (b.exp ?? "").slice(0, 40), variant = (b.variant ?? "").slice(0, 8);
  await env.DB.prepare(
    "INSERT INTO events(day, path, step, exp, variant, count) VALUES(?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1",
  ).bind(new Date().toISOString().slice(0, 10), path, b.step, exp, variant).run();
  if (b.step === "report_viewed" && typeof b.secs === "number" && b.secs > 0 && b.secs < 3600)
    await env.DB.prepare("INSERT INTO durations(day, bucket, count) VALUES(?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1")
      .bind(new Date().toISOString().slice(0, 10), bucketOf(b.secs)).run();
}

async function seedVariants(env: Env) {
  const now = new Date().toISOString();
  const stmts = EXPERIMENTS.flatMap((e) => e.variants.map((v, i) =>
    env.DB.prepare("INSERT OR IGNORE INTO variants(exp, id, copy, source, status, created_at) VALUES(?, ?, ?, ?, ?, ?)")
      .bind(e.id, v.id, JSON.stringify(v.copy), v.source, i === 0 ? "champion" : "live", now)));
  if (stmts.length) await env.DB.batch(stmts);
}

type VRow = { exp: string; id: string; copy: string; source: string; status: string };

/** Variants currently in play, for the site to pick from on each page view. */
export async function activeExperiments(env: Env) {
  await seedVariants(env);
  const { results } = await env.DB.prepare("SELECT exp, id, copy, source, status FROM variants WHERE status IN ('champion','live') ORDER BY exp, status, id").all<VRow>();
  return EXPERIMENTS.map((e) => ({
    id: e.id, page: e.page,
    variants: results.filter((r) => r.exp === e.id).map((r) => ({ id: r.id, copy: JSON.parse(r.copy) })),
  }));
}

async function armStats(env: Env, exp: string, goal: Step, since: string) {
  const { results } = await env.DB.prepare(
    "SELECT variant, step, SUM(count) AS n FROM events WHERE exp = ? AND day >= ? AND step IN ('landing', ?) GROUP BY variant, step",
  ).bind(exp, since, goal).all<{ variant: string; step: string; n: number }>();
  return (id: string) => ({
    id,
    views: results.find((r) => r.variant === id && r.step === "landing")?.n ?? 0,
    conversions: results.find((r) => r.variant === id && r.step === goal)?.n ?? 0,
  });
}

const Proposal = z.object({ h1: z.string(), cta: z.string(), rationale: z.string() });

async function propose(env: Env, champion: Record<string, string>, funnel: unknown, history: string[]) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.messages.parse({
    model: MODELS.small,
    max_tokens: 2000,
    output_config: { effort: "medium", format: zodOutputFormat(Proposal) },
    system: `Je schrijft één nieuwe testvariant voor de kop (h1) en knop (cta) van kloptmijnofferte.nl, een onafhankelijke check voor offertes van hybride warmtepompen.
Huisstijl: "je", nooit "u". Korte zinnen, B1. Cijfers boven bijvoeglijke naamwoorden. Eerlijk over onzekerheid. Geen angst, geen urgentie, geen uitroeptekens. Nooit "gratis offertes", "goedkoopste", "gegarandeerd", "100% veilig". Noem nooit een bedrag, percentage, aantal of subsidiebedrag, en geen merk- of bedrijfsnamen. Geen hoofdletterwoorden. Kop max. 12 woorden, knop max. 4 woorden.`,
    messages: [{ role: "user", content: `Huidige winnaar: ${JSON.stringify(champion)}\nEerder getest: ${history.join(" | ")}\nFunnel afgelopen 28 dagen: ${JSON.stringify(funnel)}\nBedenk één duidelijk andere variant die meer mensen laat uploaden.` }],
  });
  return { proposal: res.stop_reason === "refusal" ? null : res.parsed_output, cost: costUsd(MODELS.small, res.usage) };
}

/** Weekly: decide tests, promote winners, add one new challenger per finished test, store a report. */
export async function weeklyLearning(env: Env, extra: Record<string, unknown> = {}) {
  await seedVariants(env);
  const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const { results: steps } = await env.DB.prepare("SELECT step, SUM(count) AS count FROM events WHERE day >= ? AND path = '/' GROUP BY step").bind(since).all<{ step: Step; count: number }>();
  const funnel = dropOff(steps);
  const { results: dur } = await env.DB.prepare("SELECT bucket, SUM(count) AS count FROM durations WHERE day >= ? GROUP BY bucket").bind(since).all<{ bucket: number; count: number }>();
  const median_secs = medianFromBuckets(dur);
  const time_claim_flags: unknown[] = [];
  const report: Record<string, unknown> = { created_at: now, window_days: 28, funnel, median_upload_to_report_secs: median_secs, time_claim_flags, experiments: [] as unknown[], ...extra };

  for (const e of EXPERIMENTS) {
    const { results: rows } = await env.DB.prepare("SELECT exp, id, copy, source, status FROM variants WHERE exp = ?").bind(e.id).all<VRow>();
    for (const r of rows.filter((x) => x.status !== "retired")) {
      const claim = claimedSeconds(JSON.parse(r.copy).h1 ?? "");
      if (claim != null && median_secs != null && median_secs > claim)
        time_claim_flags.push({ exp: e.id, variant: r.id, claimed_secs: claim, median_secs, message: "Tijdsclaim is langzamer dan gemeten; pas de tekst of de snelheid aan." });
    }
    const inPlay = rows.filter((r) => r.status !== "retired").sort((a, b) => (a.status === "champion" ? -1 : b.status === "champion" ? 1 : 0));
    const stats = await armStats(env, e.id, e.goal, since);
    const arms = inPlay.map((r) => stats(r.id));
    const d = decide(arms);
    const entry: Record<string, unknown> = { exp: e.id, goal: e.goal, arms, decision: d };
    if (d.winner) {
      await env.DB.batch(inPlay.map((r) =>
        env.DB.prepare("UPDATE variants SET status = ?, decided_at = ?, reason = ? WHERE exp = ? AND id = ?")
          .bind(r.id === d.winner ? "champion" : "retired", now, d.reason, e.id, r.id)));
      const champion = JSON.parse(inPlay.find((r) => r.id === d.winner)!.copy);
      const { proposal, cost } = await propose(env, champion, funnel, rows.map((r) => JSON.parse(r.copy).h1));
      entry.proposal_cost_usd = cost;
      if (proposal) {
        const problems = [...brandLint(proposal.h1, "model"), ...brandLint(proposal.cta, "model")];
        entry.proposal = { ...proposal, problems };
        if (problems.length === 0 && env.AUTO_SHIP_VARIANTS === "true") {
          const id = `M${rows.length + 1}`;
          await env.DB.prepare("INSERT INTO variants(exp, id, copy, source, status, created_at, reason) VALUES(?, ?, ?, 'model', 'live', ?, ?)")
            .bind(e.id, id, JSON.stringify({ h1: proposal.h1, cta: proposal.cta }), now, proposal.rationale).run();
          entry.shipped = id;
        }
      }
    }
    (report.experiments as unknown[]).push(entry);
  }
  await env.DB.prepare("INSERT INTO reports(created_at, body) VALUES(?, ?)").bind(now, JSON.stringify(report)).run();
  if (env.REPORT_WEBHOOK_URL) await fetch(env.REPORT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) }).catch(() => {});
  return report;
}

export async function latestReport(env: Env) {
  return env.DB.prepare("SELECT body FROM reports ORDER BY created_at DESC LIMIT 1").first<{ body: string }>();
}
