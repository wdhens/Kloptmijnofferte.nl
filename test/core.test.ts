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

import { computeSavings, tariffsFromCbs, seedTariffs } from "../src/core/savings";
import { adviseHouse } from "../src/core/house";

describe("savings", () => {
  it("computes savings and payback with CBS Sept 2026 tariffs", () => {
    const r = computeSavings({ gas_m3_per_year: 1200, net_price: 6875 });
    expect(seedTariffs().gas_per_m3).toBeCloseTo(1.3886, 4);
    expect(r.study.gas_saved_m3).toBe(900);
    expect(r.study.extra_kwh).toBe(2035);
    expect(r.study.saving_per_year).toBe(722);
    expect(r.study.payback_years).toBe(9.5);
    expect(r.low.saving_per_year).toBeLessThan(r.study.saving_per_year);
  });
  it("reads CBS OData columns by title", () => {
    const props = [
      { ID: 1, Key: "", Title: "Aardgas" }, { ID: 2, Key: "G1", Title: "Variabel leveringstarief contractprijs", ParentID: 1 },
      { ID: 3, Key: "G2", Title: "Energiebelasting", ParentID: 1 }, { ID: 4, Key: "", Title: "Elektriciteit" },
      { ID: 5, Key: "E1", Title: "Variabel leveringstarief contractprijs", ParentID: 4 }, { ID: 6, Key: "E2", Title: "Energiebelasting", ParentID: 4 },
    ];
    const t = tariffsFromCbs(props, { G1: 0.7, G2: 0.7, E1: 0.15, E2: 0.11 }, "2026-10");
    expect(t).toMatchObject({ gas_per_m3: 1.4, as_of: "2026-10" });
    expect(t!.electricity_per_kwh).toBeCloseTo(0.26);
    expect(tariffsFromCbs(props, {}, "x")).toBeNull();
  });
});

describe("house", () => {
  it("checks the ISDE build-year rule", () => {
    expect(adviseHouse({ bouwjaar: 1998 }).isde_build_year_ok).toBe(true);
    expect(adviseHouse({ bouwjaar: 2020 }).isde_build_year_ok).toBe(false);
    expect(adviseHouse({}).isde_build_year_ok).toBeNull();
  });
});

import { brandLint, decide, dropOff, EXPERIMENTS, probBBeatsA } from "../src/core/experiments";

describe("experiments", () => {
  it("all human variants pass the brand lint", () => {
    for (const e of EXPERIMENTS) for (const v of e.variants) for (const t of Object.values(v.copy)) expect(brandLint(t)).toEqual([]);
  });
  it("rejects off-brand copy", () => {
    expect(brandLint("Gratis offertes, check uw offerte nu!").length).toBeGreaterThan(1);
  });
  it("computes win probability", () => {
    expect(probBBeatsA({ id: "A", views: 1000, conversions: 100 }, { id: "B", views: 1000, conversions: 150 })).toBeGreaterThan(0.99);
    expect(probBBeatsA({ id: "A", views: 1000, conversions: 100 }, { id: "B", views: 1000, conversions: 100 })).toBeCloseTo(0.5, 1);
  });
  it("waits for enough data and then promotes", () => {
    expect(decide([{ id: "A", views: 100, conversions: 10 }, { id: "B", views: 100, conversions: 30 }]).winner).toBeNull();
    expect(decide([{ id: "A", views: 1000, conversions: 100 }, { id: "B", views: 1000, conversions: 150 }]).winner).toBe("B");
    expect(decide([{ id: "A", views: 1000, conversions: 150 }, { id: "B", views: 1000, conversions: 100 }]).winner).toBe("A");
  });
  it("computes funnel drop-off", () => {
    const d = dropOff([{ step: "landing", count: 1000 }, { step: "upload_started", count: 200 }, { step: "upload_finished", count: 150 }]);
    expect(d[0].conversion).toBeCloseTo(0.2);
    expect(d[1].conversion).toBeCloseTo(0.75);
    expect(d[2].conversion).toBe(0);
  });
});
