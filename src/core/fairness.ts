// Places a quote in a reference band. Plain arithmetic, no model.
import type { LineCategory, ParsedQuote } from "./schema";
import priors from "./data/hybrid_price_priors.json";
import { roundTo } from "./money";

export interface Band { p25: number; median: number; p75: number; n: number | null; source: "eigen_data" | "indicatie"; }

export type Position = "laag" | "gemiddeld" | "hoog";

export interface ComponentFlag { category: LineCategory; amount: number; band: [number, number]; position: Position; }

export interface FairnessResult {
  position: Position;
  total: number;
  band: Band;
  diff_from_median: number; // rounded to €50
  component_flags: ComponentFlag[];
  missing: string[]; // Dutch questions for the installer
}

const COMPONENT_PRIORS: Partial<Record<LineCategory, [number, number]>> = {
  labour: priors.components.labour as [number, number],
  connection_kit_materials: priors.components.connection_kit_materials as [number, number],
  hydraulic_balancing: priors.components.hydraulic_balancing as [number, number],
  electrical_group: priors.components.electrical_group as [number, number],
  flue_replacement: priors.components.flue_replacement as [number, number],
  thermostat: priors.components.thermostat as [number, number],
  work_at_height: priors.components.work_at_height as [number, number],
};

/** Band from the seed priors; used until a cell has k>=5 own quotes from >=3 installers. */
export function priorBand(): Band {
  const [lo, hi] = priors.total_before_subsidy as [number, number];
  return { p25: lo, median: (lo + hi) / 2, p75: hi, n: null, source: "indicatie" };
}

function place(x: number, lo: number, hi: number): Position {
  return x < lo ? "laag" : x > hi ? "hoog" : "gemiddeld";
}

export function checkFairness(q: ParsedQuote, band: Band = priorBand()): FairnessResult {
  const total = q.total_incl_vat;
  const component_flags: ComponentFlag[] = [];
  for (const [cat, b] of Object.entries(COMPONENT_PRIORS) as [LineCategory, [number, number]][]) {
    const amount = q.line_items.filter((l) => l.category === cat).reduce((s, l) => s + l.amount_incl_vat, 0);
    if (amount > 0) {
      const position = place(amount, b[0], b[1]);
      if (position !== "gemiddeld") component_flags.push({ category: cat, amount, band: b, position });
    }
  }
  const has = (c: LineCategory) => q.line_items.some((l) => l.category === c);
  const missing: string[] = [];
  if (!q.brand || !q.model) missing.push("Welk merk en type warmtepomp krijg ik precies?");
  if (!q.meldcode) missing.push("Wat is de ISDE-meldcode van deze warmtepomp?");
  if (!has("hydraulic_balancing")) missing.push("Is waterzijdig inregelen inbegrepen?");
  if (!has("electrical_group")) missing.push("Is een aparte elektragroep nodig, en zit die in de prijs?");
  if (!has("labour")) missing.push("Wat kost de installatie (arbeid) los van de warmtepomp?");
  if (q.warranty_years == null) missing.push("Hoeveel jaar garantie krijg ik, en op welke onderdelen?");
  return {
    position: place(total, band.p25, band.p75),
    total,
    band,
    diff_from_median: roundTo(total - band.median, 50),
    component_flags,
    missing,
  };
}
