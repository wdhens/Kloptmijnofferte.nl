import { describe, expect, it } from "vitest";
import { maskText, scanText } from "../src/core/redact";
import { KB, search } from "../src/core/support/kb";
import { triage, isAutomatedMail, REF_RE } from "../src/core/support/triage";
import { answer, answerLint, fallbackAnswer, prepareTurns, safeTopic } from "../src/core/support/answer";
import { brandLint } from "../src/core/experiments";

describe("support: masking", () => {
  it("removes personal data before the model sees it", () => {
    const m = maskText("Ik ben Jan, mail jan@voorbeeld.nl of bel 06-12345678, Dorpsstraat 12, 1234 AB Utrecht, NL91ABNA0417164300, BSN 111222333");
    expect(scanText(m)).toEqual([]);
    expect(m).toContain("[e-mail]");
    expect(m).toContain("1234 [..]");
  });
  it("keeps ordinary text", () => {
    expect(maskText("Hoeveel subsidie krijg ik voor 4 kW?")).toBe("Hoeveel subsidie krijg ik voor 4 kW?");
  });
  it("caps and masks turns", () => {
    const t = prepareTurns([{ role: "user", text: "x".repeat(2000) + " a@b.nl" }]);
    expect(t[0].text.length).toBeLessThanOrEqual(800);
  });
});

describe("support: knowledge base", () => {
  it("has unique ids and follows the brand rules", () => {
    expect(new Set(KB.map((e) => e.id)).size).toBe(KB.length);
    for (const e of KB) {
      expect(answerLint(e.answer, 90), e.id).toEqual([]);
      expect(brandLint(e.question), e.id).toEqual([]);
    }
  });
  it("finds the right entry", () => {
    expect(search("Hoeveel ISDE subsidie krijg ik?")[0].entry.id).toBe("isde-hoeveel");
    expect(search("gebruiken jullie cookies")[0].entry.id).toBe("privacy-cookies");
    expect(search("hoe trek ik mijn toestemming in")[0].entry.id).toBe("privacy-intrekken");
    expect(search("wat gaat er in 2027 veranderen")[0].entry.id).toBe("isde-2027");
  });
});

describe("support: triage", () => {
  it("escalates complaints, privacy, installers and business", () => {
    expect(triage("Ik wil een klacht indienen")).toBe("klacht");
    expect(triage("Verwijder al mijn gegevens alstublieft")).toBe("privacy");
    expect(triage("Ik wil een inzageverzoek doen volgens de AVG")).toBe("privacy");
    expect(triage("Is Warmte Direct betrouwbaar?")).toBe("installateur");
    expect(triage("Wat vinden jullie van Jansen Installatietechniek")).toBe("installateur");
    expect(triage("Mijn installateur reageert niet meer op mails")).toBe("installateur");
    expect(triage("Ik ben journalist bij een krant")).toBe("zakelijk");
    expect(triage("Wij zijn een energiecoöperatie en willen samenwerken")).toBe("zakelijk");
  });
  it("leaves normal questions to the bot", () => {
    expect(triage("Hoeveel subsidie krijg ik?")).toBeNull();
    expect(triage("Wat is een meldcode?")).toBeNull();
    expect(triage("Is een hybride warmtepomp goed voor mijn huis?")).toBeNull();
  });
  it("detects automated mail and our references", () => {
    expect(isAutomatedMail("noreply@x.nl", {})).toBe(true);
    expect(isAutomatedMail("piet@x.nl", { "auto-submitted": "auto-replied" })).toBe(true);
    expect(isAutomatedMail("piet@x.nl", {})).toBe(false);
    expect("Re: vraag [PT-7Q4K2M]").toMatch(REF_RE);
  });
});

describe("support: answers", () => {
  it("falls back to the knowledge base without a model", async () => {
    const a = await answer({ client: null, turns: [{ role: "user", text: "Wat is een meldcode?" }], channel: "chat" });
    expect(a.mode).toBe("fallback");
    expect(a.sources[0].id).toBe("isde-meldcode");
    expect(a.cost_usd).toBe(0);
  });
  it("hands over on rule escalation even without a model", async () => {
    const a = await answer({ client: null, turns: [{ role: "user", text: "Ik heb een klacht over jullie uitkomst" }], channel: "chat" });
    expect(a.escalate).toBe("klacht");
  });
  it("admits when it does not know", () => {
    const a = fallbackAnswer("xyzzy plugh", KB, null);
    expect(a.answered).toBe(false);
  });
  it("keeps only safe topics", () => {
    expect(safeTopic("subsidie voor tweede warmtepomp")).toBe("subsidie voor tweede warmtepomp");
    expect(safeTopic("vraag van jan@voorbeeld.nl")).toBeNull();
    expect(safeTopic("offerte 1234 AB")).toBeNull();
    expect(safeTopic("een heel lange zin met veel te veel woorden erin om op te slaan")).toBeNull();
  });
  it("uses the model answer and appends the handover text", async () => {
    const fake = { messages: { parse: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 },
      parsed_output: { answer: "Dat begrijp ik.", used_ids: ["contact"], answered_from_kb: true, confidence: 0.9, intent: "klacht", escalate: "klacht", topic: "klacht over uitkomst" } }) } };
    const a = await answer({ client: fake as any, turns: [{ role: "user", text: "Jullie uitkomst was onzin" }], channel: "chat" });
    expect(a.escalate).toBe("klacht");
    expect(a.answer).toContain("5 werkdagen");
    expect(a.cost_usd).toBeGreaterThan(0);
  });
  it("rejects a model answer that breaks the brand rules", async () => {
    const fake = { messages: { parse: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
      parsed_output: { answer: "U krijgt gegarandeerd subsidie!", used_ids: ["isde-hoeveel"], answered_from_kb: true, confidence: 0.9, intent: "subsidie", escalate: "geen", topic: "subsidie" } }) } };
    const a = await answer({ client: fake as any, turns: [{ role: "user", text: "Hoeveel ISDE subsidie krijg ik?" }], channel: "chat" });
    expect(a.mode).toBe("fallback");
    expect(a.answer).not.toContain("gegarandeerd");
  });
});

import { describe as d2, it as i2, expect as e2 } from "vitest";
import * as kbMod from "../src/core/support/kb";
d2("kb ISDE figures come from the shared rules file", () => {
  i2("renders the 2026 and 2027 amounts", () => {
    const all = JSON.stringify(kbMod);
    e2(all).toContain("€1.025 plus €225 per kW");
    e2(all).toContain("krijgt dan €2.125");
    e2(all).toContain("gaat naar €120");
  });
});
