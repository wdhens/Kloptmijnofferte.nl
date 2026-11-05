// Support function: live chat, contact form, inbound email, escalation to the owner, and the learning loop.
// No conversation text is stored. Only daily counters and short PII-checked topic phrases are kept.
import Anthropic from "@anthropic-ai/sdk";
import PostalMime from "postal-mime";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODELS, costUsd } from "../core/parse";
import { maskText, scanText } from "../core/redact";
import { KB, type KbEntry } from "../core/support/kb";
import { answer, answerLint, Draft, draftPrompt, MAX_TURNS, safeTopic, type SupportAnswer, type Turn } from "../core/support/answer";
import { triage, isAutomatedMail, REF_RE, type Escalation } from "../core/support/triage";
import type { Env } from "./index";

const today = () => new Date().toISOString().slice(0, 10);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const newRef = () => "KMO-" + [...crypto.getRandomValues(new Uint8Array(6))].map((x) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[x % 31]).join("");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AUTO_REPLIES_PER_SENDER_PER_DAY = 3;
const AUTO_ANSWER_MIN_CONFIDENCE = 0.7;

function cors(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": env.ALLOWED_ORIGIN, "cache-control": "no-store" },
  });
}

// ---- budget and counters ------------------------------------------------------------------
async function chatSpentToday(env: Env) {
  return (await env.DB.prepare("SELECT usd FROM support_spend WHERE day = ?").bind(today()).first<{ usd: number }>())?.usd ?? 0;
}
async function addChatSpend(env: Env, usd: number) {
  await env.DB.prepare("INSERT INTO support_spend(day, usd, answers) VALUES(?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, answers = answers + 1")
    .bind(today(), usd).run();
}
/** A model client only while under the daily support cap; otherwise answers come from the knowledge base. */
async function modelClient(env: Env): Promise<Anthropic | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (Number(env.SUPPORT_DAILY_CAP_USD ?? "1") <= (await chatSpentToday(env))) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function outcomeOf(a: SupportAnswer): string {
  if (a.escalate) return "escalated";
  if (!a.answered) return "unanswered";
  if (a.confidence < 0.5) return "low_confidence";
  return "answered";
}

async function count(env: Env, channel: string, a: SupportAnswer) {
  const outcome = outcomeOf(a), day = today();
  const stmts = [
    env.DB.prepare("INSERT INTO support_stats(day, channel, intent, outcome, kb_id, count) VALUES(?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1")
      .bind(day, channel, a.intent, outcome, a.sources[0]?.id ?? ""),
  ];
  // Topics are only kept where the FAQ falls short, and only if they pass the PII checks.
  const topic = safeTopic(a.topic);
  if (topic && outcome !== "answered")
    stmts.push(env.DB.prepare("INSERT INTO support_topics(day, topic, intent, outcome, count) VALUES(?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1")
      .bind(day, topic, a.intent, outcome));
  await env.DB.batch(stmts);
}

export async function learnedEntries(env: Env): Promise<KbEntry[]> {
  const { results } = await env.DB.prepare("SELECT id, question, answer, keywords FROM kb_learned WHERE status = 'live'")
    .all<{ id: string; question: string; answer: string; keywords: string }>();
  return results.map((r) => ({ id: r.id, topic: "check", question: r.question, answer: r.answer, keywords: JSON.parse(r.keywords), source: "learned" }));
}

// ---- mail ----------------------------------------------------------------------------------
interface Mail { to: string; subject: string; text: string; replyTo?: string; inReplyTo?: string; }

export async function sendMail(env: Env, m: Mail): Promise<boolean> {
  if (!env.BREVO_API_KEY) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: env.SUPPORT_FROM, name: "kloptmijnofferte.nl" },
      to: [{ email: m.to }],
      subject: m.subject,
      textContent: m.text,
      ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
      headers: { "Auto-Submitted": "auto-replied", ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo, References: m.inReplyTo } : {}) },
    }),
  }).catch(() => null);
  return !!res?.ok;
}

const FOOTER = "\n\nDit antwoord is opgesteld door onze AI-assistent op basis van onze uitleg. Klopt er iets niet of wil je een mens spreken? Antwoord dan op deze mail.\n\nkloptmijnofferte.nl, onafhankelijk. We krijgen geen geld van installateurs.";

function dueDate(kind: string, from = new Date()): string {
  const d = new Date(from);
  if (kind === "privacy") { d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); }
  let n = 0;
  while (n < 5) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++; }
  return d.toISOString().slice(0, 10);
}

/** Ask the model for a reply the owner can send as is. Costs a fraction of a cent. */
async function draftReply(env: Env, kind: string, message: string): Promise<string | null> {
  const client = await modelClient(env);
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: MODELS.small, max_tokens: 800,
      system: `Je schrijft een concept-antwoord voor de eigenaar van kloptmijnofferte.nl (onafhankelijke check voor warmtepompoffertes, geen installateur, geen leadverkoop, beoordeelt prijzen en nooit bedrijven). Soort bericht: ${kind}. Nederlands, "je", B1, kort, vriendelijk, zonder beloftes over geld of juridische erkenning. Max. 120 woorden. Begin met "Hoi,".`,
      messages: [{ role: "user", content: maskText(message.slice(0, 4000)) }],
    });
    await addChatSpend(env, costUsd(MODELS.small, res.usage));
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return text || null;
  } catch { return null; }
}

interface Case { ref: string; channel: "chat" | "form" | "email"; kind: Escalation | "onduidelijk" | "antwoord_op_bot"; email: string; message: string; actions: string[]; }

/** Store the case, tell the owner, and confirm receipt to the sender. */
async function escalate(env: Env, c: Case, opts: { forwarded?: boolean; inReplyTo?: string; subject?: string } = {}) {
  const due = dueDate(c.kind);
  await env.DB.prepare("INSERT INTO tickets(ref, created_at, channel, kind, email, message, due_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .bind(c.ref, new Date().toISOString(), c.channel, c.kind, c.email, c.message.slice(0, 8000), due).run();

  const draft = c.kind === "antwoord_op_bot" ? null : await draftReply(env, c.kind, c.message);
  const ownerText = [
    `Nieuwe ${c.kind} via ${c.channel}. Referentie ${c.ref}. Graag reageren vóór ${due}${c.kind === "privacy" ? " (AVG: binnen 1 maand)" : ""}.`,
    `Van: ${c.email}`,
    c.actions.length ? `Al automatisch gedaan: ${c.actions.join("; ")}` : "",
    opts.forwarded ? "Het originele bericht is als aparte mail doorgestuurd." : `Bericht:\n${c.message}`,
    draft ? `\nConcept-antwoord (antwoord op deze mail om het naar ${c.email} te sturen, met aanpassingen als je wilt):\n\n${draft}` : "",
  ].filter(Boolean).join("\n\n");
  let notified = false;
  if (env.OWNER_EMAIL) notified = await sendMail(env, { to: env.OWNER_EMAIL, subject: `[${c.ref}] ${c.kind}: actie nodig`, text: ownerText, replyTo: c.email });
  if (!notified && env.REPORT_WEBHOOK_URL)
    notified = !!(await fetch(env.REPORT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "support_ticket", ref: c.ref, kind: c.kind, due, text: ownerText }) }).catch(() => null))?.ok;
  if (!notified) console.error(`ticket ${c.ref} stored but owner not notified`);

  if (c.kind !== "antwoord_op_bot") {
    const ack = ACK[c.kind];
    await sendMail(env, {
      to: c.email,
      subject: `${opts.subject ? `Re: ${opts.subject.replace(REF_RE, "").trim()} ` : "Je bericht aan kloptmijnofferte.nl "}[${c.ref}]`,
      text: `${ack.trim()}${c.actions.length ? `\n\nWat we al voor je gedaan hebben: ${c.actions.join("; ")}.` : ""}\n\nJe referentie is ${c.ref}.\n\nkloptmijnofferte.nl`,
      inReplyTo: opts.inReplyTo,
    });
  }
  return { ref: c.ref, due, notified };
}

const ACK: Record<Escalation | "onduidelijk", string> = {
  onduidelijk: "Hoi,\n\nDank je voor je vraag. Daar hebben we nog geen kant-en-klaar antwoord op, dus een mens kijkt mee. Je hoort binnen 5 werkdagen van ons.",
  klacht: "Hoi,\n\nDank je voor je bericht, en vervelend dat je ontevreden bent. Een mens bekijkt je klacht en reageert binnen 5 werkdagen.",
  privacy: "Hoi,\n\nWe hebben je privacyverzoek ontvangen. Een mens handelt het af, binnen een maand en meestal veel sneller.",
  installateur: "Hoi,\n\nWe hebben je bericht ontvangen. We beoordelen prijzen, nooit bedrijven, dus over een specifieke installateur geven we geen oordeel. Een mens kijkt wel naar je vraag en reageert binnen 5 werkdagen.",
  zakelijk: "Hoi,\n\nDank je voor je bericht. Zakelijke vragen beantwoordt de eigenaar zelf, binnen 5 werkdagen.",
};

// ---- self-service privacy actions -----------------------------------------------------------
/** Withdraw a stored quote when the message contains a check code. Same rules as /api/withdraw (30 days). */
async function withdrawFromText(env: Env, text: string): Promise<string[]> {
  const actions: string[] = [];
  const codes = new Set(text.toUpperCase().match(/\b[A-HJ-NP-Z2-9]{6}\b/g) ?? []);
  for (const c of codes) {
    if (!/\d/.test(c)) continue; // ordinary words are not codes
    const h = await sha256(c);
    const res = await env.DB.prepare("DELETE FROM quotes WHERE check_code_hash = ? AND created_at >= ?")
      .bind(h, new Date(Date.now() - 30 * 864e5).toISOString()).run();
    if (res.meta.changes) actions.push(`offerte met intrekcode ${c} verwijderd`);
  }
  return actions;
}

/** Only for mail, where the sender address is checked by the mail system: remove that address from the mailing list. */
async function removeSignup(env: Env, email: string): Promise<string[]> {
  const res = await env.DB.prepare("DELETE FROM signups WHERE email = ?").bind(email.toLowerCase()).run();
  return res.meta.changes ? [`${email} van onze maillijst verwijderd`] : [];
}

// ---- HTTP: chat -----------------------------------------------------------------------------
export async function handleChat(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as { turns?: Turn[] };
  const turns = Array.isArray(body.turns) ? body.turns.slice(-MAX_TURNS * 2) : [];
  const userTurns = turns.filter((t) => t?.role === "user");
  if (!userTurns.length || typeof userTurns.at(-1)!.text !== "string") return cors(env, { error: "leeg" }, 400);
  if (userTurns.length > MAX_TURNS)
    return cors(env, { answer: "Dit gesprek is lang geworden. Wil je dat een mens meekijkt? Laat dan je e-mailadres en je vraag achter.", escalate: null, show_form: true, sources: [] });
  const client = await modelClient(env);
  const a = await answer({ client, turns, learned: await learnedEntries(env), channel: "chat" });
  if (a.cost_usd) await addChatSpend(env, a.cost_usd);
  await count(env, "chat", a);
  return cors(env, {
    answer: a.answer,
    sources: a.sources,
    escalate: a.escalate,
    show_form: !!a.escalate || !a.answered || a.confidence < 0.5,
    intent: a.intent,
  });
}

/** Thumbs up or down on a chat answer: counters only. */
export async function handleChatFeedback(req: Request, env: Env) {
  const b = (await req.json().catch(() => ({}))) as { kb_id?: string; helpful?: boolean; intent?: string };
  if (typeof b.helpful !== "boolean") return cors(env, { error: "helpful" }, 400);
  const ids = new Set([...KB.map((k) => k.id), ...(await learnedEntries(env)).map((k) => k.id), ""]);
  const kb = ids.has(b.kb_id ?? "") ? b.kb_id ?? "" : "";
  const intent = (b.intent ?? "anders").slice(0, 20);
  await env.DB.prepare("INSERT INTO support_stats(day, channel, intent, outcome, kb_id, count) VALUES(?, 'chat', ?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1")
    .bind(today(), intent, b.helpful ? "helpful" : "unhelpful", kb).run();
  return cors(env, { ok: true });
}

// ---- HTTP: contact form ---------------------------------------------------------------------
export async function handleContact(req: Request, env: Env) {
  const b = (await req.json().catch(() => ({}))) as { email?: string; message?: string; kind?: string; website?: string; elapsed_ms?: number; from_chat?: boolean };
  if (b.website) return cors(env, { ok: true }); // honeypot: bots fill hidden fields
  if (typeof b.elapsed_ms === "number" && b.elapsed_ms < 2500) return cors(env, { ok: true });
  const email = (b.email ?? "").trim().toLowerCase();
  const message = (b.message ?? "").trim().slice(0, 4000);
  if (!EMAIL_RE.test(email)) return cors(env, { error: "email", message: "Vul een geldig e-mailadres in." }, 400);
  if (message.length < 5) return cors(env, { error: "bericht", message: "Schrijf je vraag of bericht." }, 400);
  if (!(await underMailRate(env, email))) return cors(env, { error: "te_vaak", message: "Je hebt vandaag al een paar berichten gestuurd. We reageren zo snel mogelijk." }, 429);

  const hinted = (["klacht", "privacy", "installateur", "zakelijk"] as const).find((k) => k === b.kind) ?? null;
  const ruleKind = triage(message) ?? hinted;
  const ref = newRef();
  if (ruleKind) {
    const r = await escalate(env, { ref, channel: b.from_chat ? "chat" : "form", kind: ruleKind, email, message, actions: [] });
    await bump(env, b.from_chat ? "chat" : "form", ruleKind, "escalated");
    return cors(env, { ok: true, mode: "ticket", ref: r.ref, message: `We hebben je bericht ontvangen. Je referentie is ${r.ref}. We reageren vóór ${fmt(r.due)}.` });
  }
  const a = await answer({ client: await modelClient(env), turns: [{ role: "user", text: message }], learned: await learnedEntries(env), channel: "email" });
  if (a.cost_usd) await addChatSpend(env, a.cost_usd);
  await count(env, "form", a);
  if (!a.escalate && a.answered && a.confidence >= AUTO_ANSWER_MIN_CONFIDENCE) {
    const sent = await sendMail(env, { to: email, subject: `Antwoord op je vraag [${ref}]`, text: `${a.answer}${linksText(a)}${FOOTER}` });
    return cors(env, { ok: true, mode: "answered", ref, answer: a.answer, sources: a.sources, mailed: sent });
  }
  const r = await escalate(env, { ref, channel: "form", kind: a.escalate ?? "onduidelijk", email, message, actions: [] });
  return cors(env, { ok: true, mode: "ticket", ref: r.ref, message: `We hebben je bericht ontvangen. Je referentie is ${r.ref}. We reageren vóór ${fmt(r.due)}.` });
}

const fmt = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
const linksText = (a: SupportAnswer) => {
  const links = a.sources.flatMap((s) => s.links ?? []);
  return links.length ? `\n\nMeer lezen:\n${[...new Map(links.map((l) => [l.href, l])).values()].map((l) => `- ${l.label}: ${l.href.startsWith("http") ? l.href : `https://kloptmijnofferte.nl${l.href}`}`).join("\n")}` : "";
};

async function bump(env: Env, channel: string, intent: string, outcome: string) {
  await env.DB.prepare("INSERT INTO support_stats(day, channel, intent, outcome, kb_id, count) VALUES(?, ?, ?, ?, '', 1) ON CONFLICT DO UPDATE SET count = count + 1")
    .bind(today(), channel, intent, outcome).run();
}

async function underMailRate(env: Env, email: string) {
  const h = await sha256(email.toLowerCase());
  const row = await env.DB.prepare("INSERT INTO mail_rate(day, sender_hash, count) VALUES(?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count")
    .bind(today(), h).first<{ count: number }>();
  return (row?.count ?? 1) <= MAX_AUTO_REPLIES_PER_SENDER_PER_DAY;
}

// ---- inbound email (Cloudflare Email Routing -> this Worker) --------------------------------
export async function handleEmail(message: ForwardableEmailMessage, env: Env) {
  const raw = await new Response(message.raw).arrayBuffer();
  const mail = await PostalMime.parse(raw);
  const from = (mail.from?.address ?? message.from).toLowerCase();
  const headers = Object.fromEntries((mail.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
  const subject = mail.subject ?? "";
  const text = (mail.text ?? (mail.html ?? "").replace(/<[^>]+>/g, " ")).replace(/\n>.*$/gs, "").trim().slice(0, 8000);
  const owner = env.OWNER_EMAIL;

  if (isAutomatedMail(from, headers)) { if (owner) await message.forward(owner); return; }
  if (owner && from === owner.toLowerCase()) return; // never answer ourselves
  // A reply to one of our mails always goes to a human.
  const refMatch = subject.match(REF_RE);
  if (refMatch) {
    if (owner) await message.forward(owner);
    await bump(env, "email", "antwoord_op_bot", "escalated");
    return;
  }
  if (!(await underMailRate(env, from))) { if (owner) await message.forward(owner); return; }

  const ref = newRef();
  const ruleKind = triage(`${subject}\n${text}`);
  let kind: Case["kind"] | null = ruleKind;
  let a: SupportAnswer | null = null;
  if (!kind) {
    a = await answer({ client: await modelClient(env), turns: [{ role: "user", text: `${subject}\n\n${text}` }], learned: await learnedEntries(env), channel: "email" });
    if (a.cost_usd) await addChatSpend(env, a.cost_usd);
    await count(env, "email", a);
    if (!a.escalate && a.answered && a.confidence >= AUTO_ANSWER_MIN_CONFIDENCE) {
      const ok = await sendMail(env, { to: from, subject: `Re: ${subject || "je vraag"} [${ref}]`, text: `${a.answer}${linksText(a)}${FOOTER}`, inReplyTo: mail.messageId });
      if (ok) return;
    }
    kind = a.escalate ?? "onduidelijk";
  } else await bump(env, "email", kind, "escalated");

  const actions = kind === "privacy" ? [...(await withdrawFromText(env, text)), ...(/afmeld|uitschrijv|verwijder|wis/i.test(text) ? await removeSignup(env, from) : [])] : [];
  if (owner) await message.forward(owner);
  await escalate(env, { ref, channel: "email", kind, email: from, message: `${subject}\n\n${text}`, actions }, { forwarded: !!owner, inReplyTo: mail.messageId, subject });
}

// ---- daily housekeeping and weekly learning ---------------------------------------------------
export async function dailySupport(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE tickets SET email = NULL, message = NULL, purged_at = ? WHERE purged_at IS NULL AND created_at < ?")
      .bind(new Date().toISOString(), new Date(now - 30 * 864e5).toISOString()),
    env.DB.prepare("DELETE FROM support_topics WHERE day < ?").bind(new Date(now - 180 * 864e5).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM mail_rate WHERE day < ?").bind(new Date(now - 2 * 864e5).toISOString().slice(0, 10)),
  ]);
}

export const RETIRE_MIN_VOTES = 5;

/** Weekly: retire learned answers people find unhelpful, draft new FAQ entries for recurring gaps, and report. */
export async function weeklySupport(env: Env) {
  const since = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const { results: stats } = await env.DB.prepare(
    "SELECT channel, intent, outcome, kb_id, SUM(count) AS n FROM support_stats WHERE day >= ? GROUP BY channel, intent, outcome, kb_id",
  ).bind(since).all<{ channel: string; intent: string; outcome: string; kb_id: string; n: number }>();

  // 1. Retire learned entries with clearly negative feedback.
  const retired: string[] = [];
  const learned = await learnedEntries(env);
  for (const e of learned) {
    const up = stats.filter((s) => s.kb_id === e.id && s.outcome === "helpful").reduce((x, s) => x + s.n, 0);
    const down = stats.filter((s) => s.kb_id === e.id && s.outcome === "unhelpful").reduce((x, s) => x + s.n, 0);
    if (down >= RETIRE_MIN_VOTES && down > 2 * up) {
      await env.DB.prepare("UPDATE kb_learned SET status = 'retired', reason = ? WHERE id = ?").bind(`${down} keer niet nuttig, ${up} keer nuttig`, e.id).run();
      retired.push(e.id);
    }
  }

  // 2. Recurring gaps: topics seen at least 3 times in 4 weeks.
  const { results: topics } = await env.DB.prepare(
    "SELECT topic, SUM(count) AS n FROM support_topics WHERE day >= ? GROUP BY topic HAVING n >= 3 ORDER BY n DESC LIMIT 40",
  ).bind(since).all<{ topic: string; n: number }>();

  const report: Record<string, unknown> = { window_days: 28, totals: summarise(stats), retired, recurring_gaps: topics, shipped: [], drafts: [], needs_human: [] };
  const live = [...KB, ...(await learnedEntries(env))];
  const client = topics.length ? await modelClient(env) : null;
  if (client) {
    try {
      const res = await client.messages.parse({
        model: MODELS.small, max_tokens: 3000,
        system: draftPrompt(live),
        output_config: { effort: "medium", format: zodOutputFormat(Draft) },
        messages: [{ role: "user", content: topics.map((t) => `${t.n}x ${t.topic}`).join("\n") }],
      });
      await addChatSpend(env, costUsd(MODELS.small, res.usage));
      const known = new Set(live.map((e) => e.id));
      for (const d of res.parsed_output?.entries ?? []) {
        const problems = [...answerLint(d.answer, 90), ...answerLint(d.question, 14)];
        if (!d.based_on_ids.length || d.based_on_ids.some((id) => !known.has(id))) problems.push("niet gebaseerd op bestaande kennisbank");
        if (scanText(d.keywords.join(" ")).length) problems.push("persoonsgegevens in trefwoorden");
        const id = `L-${now.slice(0, 10)}-${(await sha256(d.question)).slice(0, 6)}`;
        const status = problems.length === 0 && env.AUTO_SHIP_FAQ === "true" ? "live" : "draft";
        await env.DB.prepare("INSERT OR IGNORE INTO kb_learned(id, question, answer, keywords, based_on, status, created_at, reason) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, d.question, d.answer, JSON.stringify(d.keywords.slice(0, 12)), JSON.stringify(d.based_on_ids), status, now, problems.join("; ") || `dekt: ${d.covers_topics.join(", ")}`).run();
        (report[status === "live" ? "shipped" : "drafts"] as unknown[]).push({ id, question: d.question, problems });
      }
      report.needs_human = res.parsed_output?.gaps ?? [];
    } catch (e) {
      report.error = e instanceof Error ? e.message : "unknown";
    }
  }
  const { results: tickets } = await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM tickets WHERE created_at >= ? GROUP BY kind").bind(since).all();
  report.tickets_by_kind = tickets;
  return report;
}

function summarise(stats: { channel: string; outcome: string; n: number }[]) {
  const by = (k: string) => stats.filter((s) => s.outcome === k).reduce((x, s) => x + s.n, 0);
  const asked = by("answered") + by("unanswered") + by("low_confidence") + by("escalated");
  return {
    questions: asked,
    answered_by_bot: by("answered"),
    escalated: by("escalated"),
    unanswered: by("unanswered") + by("low_confidence"),
    self_service_rate: asked ? Math.round((by("answered") / asked) * 1000) / 1000 : null,
    helpful: by("helpful"), unhelpful: by("unhelpful"),
  };
}

/** Public FAQ: static entries plus learned ones that are live. */
export async function handleFaq(env: Env) {
  const learned = await learnedEntries(env);
  return new Response(JSON.stringify(learned.map(({ id, question, answer }) => ({ id, question, answer }))), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": env.ALLOWED_ORIGIN, "cache-control": "public, max-age=3600" },
  });
}

