// ISDE subsidy for a first air-water heat pump (incl. hybrid), owner-occupier.
// Rules come from data/isde_air_water_heat_pump.json (Data and quality thread).
import isde from "./data/isde_air_water_heat_pump.json";

export interface IsdeInput {
  subsidiable_kw?: number; // from RVO meldcode list, not the marketed kW
  energy_label?: string;
  smart_protocol?: string;
  purchase_date: string; // signed quote or order confirmation date, YYYY-MM-DD
}

export interface IsdeResult {
  amount: number | null;
  year: number;
  status: "definitief" | "indicatief" | "onbekend";
  breakdown: { base: number; per_kw: number; label_bonus: number; smart_bonus: number };
  notes: string[];
}

type Rule = (typeof isde.rules)[number] & { smart_protocols?: string[]; status?: string };

export function computeIsde(input: IsdeInput): IsdeResult {
  const year = Number(input.purchase_date.slice(0, 4));
  const rules = isde.rules as Rule[];
  const rule = rules.find((r) => r.year === year) ?? (year > 2027 ? undefined : rules.find((r) => r.year === 2026));
  const notes: string[] = [];
  const empty = { base: 0, per_kw: 0, label_bonus: 0, smart_bonus: 0 };
  if (!rule) return { amount: null, year, status: "onbekend", breakdown: empty, notes: ["Geen ISDE-regels bekend voor dit jaar."] };
  if (input.subsidiable_kw == null) {
    notes.push("Subsidiabel vermogen onbekend: zoek de meldcode op in de RVO-lijst.");
    return { amount: null, year: rule.year, status: "onbekend", breakdown: empty, notes };
  }
  const base = rule.base;
  const per_kw = Math.round(rule.per_kw_subsidiable * input.subsidiable_kw);
  const label_bonus = input.energy_label?.replace(/\s/g, "").toUpperCase() === "A+++" ? rule["label_bonus_A+++"] : 0;
  const protocols = rule.smart_protocols ?? [];
  const smart_bonus =
    rule.smart_bonus && input.smart_protocol && protocols.some((p) => p.toLowerCase() === input.smart_protocol!.toLowerCase())
      ? rule.smart_bonus
      : 0;
  const status = rule.status ? "indicatief" : "definitief";
  if (rule.status) notes.push("De regels voor 2027 zijn aangekondigd maar nog niet definitief, ook niet voor hybride warmtepompen.");
  if (year === 2027) notes.push("Getekend vóór 1 januari 2027 en in 2027 geïnstalleerd? Dan geldt het tarief van 2026.");
  return { amount: base + per_kw + label_bonus + smart_bonus, year: rule.year, status, breakdown: { base, per_kw, label_bonus, smart_bonus }, notes };
}

export const ISDE_CONDITIONS: string[] = isde.conditions;
export const ISDE_SOURCES: string[] = isde.sources;
