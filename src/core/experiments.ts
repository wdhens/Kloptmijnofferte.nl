// Cookieless A/B testing: variants are picked per page view, never stored on the device.
// A variant only goes live if it passes the brand lint; a winner is promoted automatically.

export const FUNNEL = ["landing", "upload_started", "upload_finished", "report_viewed", "email_signup"] as const;
export type Step = (typeof FUNNEL)[number];

export interface Variant { id: string; copy: Record<string, string>; source: "human" | "model"; }
export interface Experiment { id: string; page: string; goal: Step; variants: Variant[]; }

export const EXPERIMENTS: Experiment[] = [
  {
    id: "hero-2026-11",
    page: "/",
    goal: "upload_finished",
    variants: [
      { id: "A", source: "human", copy: { h1: "Weet binnen 2 minuten of je offerte eerlijk is", cta: "Check mijn offerte" } },
      { id: "B", source: "human", copy: { h1: "Klopt de prijs van je warmtepompofferte?", cta: "Offerte checken" } },
      { id: "C", source: "human", copy: { h1: "Een tweede mening op je offerte, zonder installateurs", cta: "Tweede mening krijgen" } },
      { id: "D", source: "human", copy: { h1: "Klopt je offerte, en hoeveel subsidie krijg je?", cta: "Offerte en subsidie checken" } },
      { id: "E", source: "human", copy: { h1: "Betaal je te veel voor je hybride warmtepomp?", cta: "Vergelijk mijn offerte" } },
      // Held until own data reaches k>=5, since the claim "echte offertes" is not true before that:
      // { id: "F", source: "human", copy: { h1: "Vergelijk je offerte met echte offertes van andere huiseigenaren", cta: "Offerte uploaden" } },
    ],
  },
];

// Brand rules from Growth (brand-and-tone, 2026-11-05).
const BANNED: RegExp[] = [
  /(^|[^\p{L}])(u|uw)(?![\p{L}])/iu, /!/, /gratis offertes/i, /goedkoopste/i, /gegarandeerd/i, /100% veilig/i,
  /knaller/i, /\bdeals?\b/i, /scherpste prijs/i, /beste prijs/i, /laatste kans/i, /op\s*=\s*op/i, /nu of nooit/i,
  /alleen vandaag/i, /\bsnel/i, /duizenden/i, /\b\d[\d.]*\+?\s*(huiseigenaren|klanten|gebruikers|mensen)/i,
  /bespaar\w*[^.]*(€|\beuro\b|\d)/i, /beperkt/i,
];
export const BRAND_NAMES = ["homedeal", "werkspot", "trustoo", "daikin", "remeha", "weheat", "intergas", "dewarmte", "quatt", "vaillant", "nefit", "itho", "atag", "bosch", "mitsubishi", "panasonic"];
const CAPS_ALLOWED = new Set(["ISDE", "RVO", "CBS", "BTW"]);

export function brandLint(text: string, source: Variant["source"] = "human"): string[] {
  const problems = BANNED.filter((r) => r.test(text)).map((r) => `verboden patroon ${r}`);
  const lower = text.toLowerCase();
  for (const b of BRAND_NAMES) if (lower.includes(b)) problems.push(`merknaam ${b}`);
  for (const w of text.match(/\b\p{Lu}{3,}\b/gu) ?? []) if (!CAPS_ALLOWED.has(w)) problems.push(`hoofdletters ${w}`);
  if (source === "model" && /€|\beuro\b|\d/i.test(text)) problems.push("model mag geen bedragen of getallen noemen");
  if (text.split(/\s+/).length > 14) problems.push("langer dan 14 woorden");
  return problems;
}

/** Seconds claimed in copy like "binnen 2 minuten", or null. */
export function claimedSeconds(text: string): number | null {
  const m = text.match(/(\d+)\s*(minuut|minuten|seconden)/i);
  return m ? Number(m[1]) * (m[2].toLowerCase().startsWith("sec") ? 1 : 60) : null;
}

export const DURATION_BUCKETS_S = [15, 30, 45, 60, 90, 120, 180, 300, 600];
export const bucketOf = (s: number) => DURATION_BUCKETS_S.find((b) => s <= b) ?? 9999;
/** Median from bucket counts (upper edge of the bucket holding the middle value). */
export function medianFromBuckets(rows: { bucket: number; count: number }[]): number | null {
  const sorted = [...rows].sort((a, b) => a.bucket - b.bucket);
  const total = sorted.reduce((s, r) => s + r.count, 0);
  if (!total) return null;
  let acc = 0;
  for (const r of sorted) { acc += r.count; if (acc >= total / 2) return r.bucket; }
  return null;
}

/** Deterministic pick from a per-page-view random number. */
export function pick<T>(items: T[], r: number): T { return items[Math.min(items.length - 1, Math.floor(r * items.length))]; }

// ---- statistics --------------------------------------------------------------
export interface ArmStats { id: string; views: number; conversions: number; }

function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Probability that arm b converts better than arm a (normal approximation of Beta posteriors). */
export function probBBeatsA(a: ArmStats, b: ArmStats): number {
  const post = (s: ArmStats) => {
    const al = s.conversions + 1, be = s.views - s.conversions + 1;
    const mean = al / (al + be);
    return { mean, v: (al * be) / ((al + be) ** 2 * (al + be + 1)) };
  };
  const pa = post(a), pb = post(b);
  return normalCdf((pb.mean - pa.mean) / Math.sqrt(pa.v + pb.v));
}

export const MIN_VIEWS_PER_ARM = 300;
export const WIN_PROB = 0.95;

export interface Decision { winner: string | null; reason: string; probs: Record<string, number>; }

/** Champion = first arm. A challenger wins when P(better) >= 95% and every arm has 300+ views. */
export function decide(arms: ArmStats[]): Decision {
  const [champ, ...rest] = arms;
  const probs: Record<string, number> = {};
  for (const c of rest) probs[c.id] = Math.round(probBBeatsA(champ, c) * 1000) / 1000;
  if (arms.some((a) => a.views < MIN_VIEWS_PER_ARM)) return { winner: null, reason: `te weinig data (minimaal ${MIN_VIEWS_PER_ARM} per variant)`, probs };
  const best = rest.filter((c) => probs[c.id] >= WIN_PROB).sort((x, y) => probs[y.id] - probs[x.id])[0];
  if (best) return { winner: best.id, reason: `kans ${probs[best.id]} dat ${best.id} beter is dan ${champ.id}`, probs };
  if (rest.every((c) => probs[c.id] <= 1 - WIN_PROB)) return { winner: champ.id, reason: "huidige versie blijft beter", probs };
  return { winner: null, reason: "nog geen duidelijk verschil", probs };
}

export interface StepCount { step: Step; count: number; }
/** Drop-off between consecutive funnel steps, as shares 0..1. */
export function dropOff(counts: StepCount[]) {
  const m = new Map(counts.map((c) => [c.step, c.count]));
  return FUNNEL.slice(1).map((step, i) => {
    const prev = m.get(FUNNEL[i]) ?? 0, cur = m.get(step) ?? 0;
    return { from: FUNNEL[i], to: step, from_count: prev, to_count: cur, conversion: prev ? cur / prev : 0 };
  });
}
