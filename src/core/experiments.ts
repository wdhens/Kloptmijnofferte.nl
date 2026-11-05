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
    ],
  },
];

// Brand rules from Growth (brand-and-tone): je not u, no "!" , no fear or urgency, banned phrases.
const BANNED = [/\bu\b/i, /\buw\b/i, /!/, /gratis offertes/i, /goedkoopste/i, /gegarandeerd/i, /100% veilig/i, /nu of nooit/i, /laatste kans/i, /snel(?:\s+)?zijn/i, /beperkt/i];
export function brandLint(text: string): string[] {
  const problems = BANNED.filter((r) => r.test(text)).map((r) => `verboden patroon ${r}`);
  if (text.split(/\s+/).length > 14) problems.push("langer dan 14 woorden");
  return problems;
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
