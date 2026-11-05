// Validation rules from the Data and quality spec.
import type { ParsedQuote } from "./schema";
import { VAT_RATE } from "./money";
import priors from "./data/hybrid_price_priors.json";
import { computeIsde } from "./isde";

export interface ValidationIssue { code: string; severity: "block" | "review" | "info"; message: string; }

export function validateQuote(q: ParsedQuote): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const [lo, hi] = priors.validation_hard_bounds_total_incl_vat;
  if (!(q.total_incl_vat > 0)) out.push({ code: "no_total", severity: "block", message: "Geen totaalprijs gevonden." });
  else if (q.total_incl_vat < lo || q.total_incl_vat > hi)
    out.push({ code: "total_out_of_bounds", severity: "review", message: `Totaal buiten €${lo}-€${hi}.` });

  if (q.line_items.length > 0 && q.total_incl_vat > 0) {
    const sum = q.line_items.reduce((s, l) => s + l.amount_incl_vat, 0);
    if (Math.abs(sum - q.total_incl_vat) > 1)
      out.push({ code: "lines_dont_sum", severity: "review", message: `Regels tellen op tot ${sum.toFixed(2)}, totaal is ${q.total_incl_vat.toFixed(2)}.` });
  }
  if (q.total_excl_vat != null && q.total_incl_vat > 0) {
    const expected = q.total_excl_vat * (1 + VAT_RATE);
    if (Math.abs(expected - q.total_incl_vat) > 1)
      out.push({ code: "vat_mismatch", severity: "review", message: "Btw is geen 21%." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.quote_date))
    out.push({ code: "no_quote_date", severity: "block", message: "Geen offertedatum gevonden." });
  if (!q.meldcode) out.push({ code: "no_meldcode", severity: "info", message: "Geen meldcode op de offerte." });
  if (q.stated_subsidy != null && /^\d{4}/.test(q.quote_date)) {
    const isde = computeIsde({ ...q, purchase_date: q.signed_date ?? q.quote_date });
    if (isde.amount != null && Math.abs(isde.amount - q.stated_subsidy) > 50)
      out.push({ code: "subsidy_mismatch", severity: "info", message: "Genoemde subsidie wijkt meer dan €50 af van onze berekening." });
  }
  if (q.confidence < 0.6) out.push({ code: "low_confidence", severity: "review", message: "Uitlezen was onzeker." });
  return out;
}

export const isBlocked = (issues: ValidationIssue[]) => issues.some((i) => i.severity === "block");
