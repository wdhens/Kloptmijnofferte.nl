import { describe, expect, it } from "vitest";
import { isValidBsn, isValidIban, scanRecord, scanText, toPc4 } from "../src/core/redact";
import { computeIsde } from "../src/core/isde";
import { checkFairness } from "../src/core/fairness";
import { validateQuote } from "../src/core/validate";
import { aggregate } from "../src/core/aggregate";
import { needsEscalation, toParsedQuote, costUsd } from "../src/core/parse";
import type { ParsedQuote } from "../src/core/schema";

const quote = (over: Partial<ParsedQuote> = {}): ParsedQuote => ({
  product: "hybrid_heat_pump", brand: "Quatt", model: "Hybrid 6kW", meldcode: "KA21789", subsidiable_kw: 4,
  energy_label: "A+++", quote_date: "2026-10-12", total_excl_vat: 7438.02, total_incl_vat: 9000, warranty_years: 10,
  line_items: [
    { description: "Warmtepomp", category: "heat_pump", amount_incl_vat: 4500 },
    { description: "Montage", category: "labour", amount_incl_vat: 2200 },
    { description: "Aansluitset", category: "connection_kit_materials", amount_incl_vat: 1500 },
    { description: "Waterzijdig inregelen", category: "hydraulic_balancing", amount_incl_vat: 950 },
    { description: "Elektragroep", category: "electrical_group", amount_incl_vat: 600 },
    { description: "Korting", category: "discount", amount_incl_vat: -750 },
  ],
  confidence: 0.9, ...over,
});

describe("redaction", () => {
  it("validates BSN with the 11-test", () => {
    expect(isValidBsn("111222333")).toBe(true);
    expect(isValidBsn("123456789")).toBe(false);
  });
  it("validates IBAN checksums", () => {
    expect(isValidIban("NL91ABNA0417164300")).toBe(true);
    expect(isValidIban("NL91ABNA0417164301")).toBe(false);
  });
  it("finds personal data", () => {
    expect(scanText("mail jan@voorbeeld.nl")).toContain("email");
    expect(scanText("bel 06-12345678")).toContain("phone");
    expect(scanText("NL91ABNA0417164300")).toContain("iban");
    expect(scanText("1234 AB Utrecht")).toContain("postcode_full");
    expect(scanText("Dorpsstraat 12")).toContain("street_address");
    expect(scanText("BSN 111222333")).toContain("bsn");
  });
  it("leaves normal quote text alone", () => {
    expect(scanText("Hybride warmtepomp 6 kW incl. montage, 2 x boren")).toEqual([]);
    expect(scanRecord(quote())).toEqual([]);
  });
  it("reports the path of a hit", () => {
    const q = quote({ line_items: [{ description: "Montage bij Kerkstraat 4", category: "labour", amount_incl_vat: 1 }] });
    expect(scanRecord(q)[0]).toEqual({ kind: "street_address", path: "$.line_items[0].description" });
  });
  it("cuts postcodes to 4 digits", () => expect(toPc4("3511 AB")).toBe("3511"));
});

describe("ISDE", () => {
  it("matches the RVO example: Quatt Hybrid 6kW = 4 subsidiable kW = €2125 in 2026", () => {
    const r = computeIsde({ subsidiable_kw: 4, energy_label: "A+++", purchase_date: "2026-10-12" });
    expect(r.amount).toBe(2125);
    expect(r.status).toBe("definitief");
  });
  it("uses the announced 2027 rate and marks it as indicative", () => {
    const r = computeIsde({ subsidiable_kw: 4, energy_label: "A+++", smart_protocol: "EEBus", purchase_date: "2027-02-01" });
    expect(r.amount).toBe(1025 + 480 + 250 + 200);
    expect(r.status).toBe("indicatief");
  });
  it("needs subsidiable kW", () => expect(computeIsde({ purchase_date: "2026-05-01" }).amount).toBeNull());
});

describe("validation", () => {
  it("accepts a consistent quote", () => expect(validateQuote(quote())).toEqual([]));
  it("flags lines that don't sum and wrong VAT", () => {
    const codes = validateQuote(quote({ total_incl_vat: 9500 })).map((i) => i.code);
    expect(codes).toContain("lines_dont_sum");
    expect(codes).toContain("vat_mismatch");
  });
  it("blocks a quote without date", () => expect(validateQuote(quote({ quote_date: "" })).some((i) => i.severity === "block")).toBe(true));
  it("flags a stated subsidy far from ours", () =>
    expect(validateQuote(quote({ stated_subsidy: 3000 })).map((i) => i.code)).toContain("subsidy_mismatch"));
});

describe("fairness", () => {
  it("places €9000 inside the prior band", () => {
    const r = checkFairness(quote());
    expect(r.position).toBe("gemiddeld");
    expect(r.diff_from_median).toBe(0);
    expect(r.band.source).toBe("indicatie");
    expect(r.missing).toEqual([]);
  });
  it("calls €13,000 high and lists missing items", () => {
    const r = checkFairness(quote({ total_incl_vat: 13000, meldcode: undefined, line_items: [] }));
    expect(r.position).toBe("hoog");
    expect(r.diff_from_median).toBe(4000);
    expect(r.missing.length).toBeGreaterThan(2);
  });
  it("flags an expensive component", () => {
    const q = quote();
    q.line_items[1].amount_incl_vat = 4000;
    expect(checkFairness(q).component_flags[0]).toMatchObject({ category: "labour", position: "hoog" });
  });
});

describe("aggregation", () => {
  const rows = (n: number, installers: number) =>
    Array.from({ length: n }, (_, i) => ({ cell: "hybrid|NH|2026-11", total_incl_vat: 8000 + i * 100, installer_key: `i${i % installers}`, uploader_key: `u${i}` }));
  it("publishes only with 5 uploaders and 3 installers", () => {
    expect(aggregate(rows(4, 3))).toEqual([]);
    expect(aggregate(rows(6, 2))).toEqual([]);
    expect(aggregate(rows(5, 3))).toEqual([{ cell: "hybrid|NH|2026-11", n: 5, p25: 8100, median: 8200, p75: 8300 }]);
  });
});

describe("parser helpers", () => {
  it("escalates on low confidence or broken sums", () => {
    expect(needsEscalation(quote())).toBe(false);
    expect(needsEscalation(quote({ confidence: 0.5 }))).toBe(true);
    expect(needsEscalation(quote({ total_incl_vat: 9500 }))).toBe(true);
  });
  it("maps nulls and cleans pc4/kvk", () => {
    const q = toParsedQuote({
      is_heat_pump_quote: true, brand: null, model: null, meldcode: null, marketed_kw: null, energy_label: null, smart_protocol: null,
      quote_date: "2026-10-01", signed_date: null, total_excl_vat: null, vat_amount: null, total_incl_vat: 8000, stated_subsidy: null,
      warranty_years: null, postcode_digits: "1234", installer_kvk: "KvK 1234 5678", line_items: [], confidence: 0.8,
    });
    expect(q.brand).toBeUndefined();
    expect(q.pc4).toBe("1234");
    expect(q.installer_kvk).toBe("12345678");
  });
  it("prices a Haiku call", () => expect(costUsd("claude-haiku-5-5", { input_tokens: 10000, output_tokens: 2000 })).toBeCloseTo(0.002));
});
