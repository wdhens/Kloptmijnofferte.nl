// Deterministic triage: which messages go to the owner instead of (only) the bot.
// Escalate: complaints, privacy/GDPR requests, questions about specific installers,
// and business, partner or press contact (owner rule: first contact with companies/press is the owner's).
// The model can also escalate; this layer makes sure the rules hold even if the model misses it.

export type Escalation = "klacht" | "privacy" | "installateur" | "zakelijk";

const RULES: { kind: Escalation; patterns: RegExp[] }[] = [
  {
    kind: "privacy",
    patterns: [
      /\b(avg|gdpr|privacywet|datalek|functionaris gegevensbescherming|autoriteit persoonsgegevens)\b/i,
      /\b(inzage|inzageverzoek|recht op (vergetelheid|inzage|verwijdering|bezwaar)|bezwaar tegen)\b/i,
      /\b(verwijder|wis|schrap)\w*\b.{0,40}\b(gegevens|data|e-?mail|account|offerte)\b/i,
      /\b(gegevens|data|e-?mail)\b.{0,40}\b(verwijder|wissen|gewist|schrappen|inzien)\w*/i,
    ],
  },
  {
    kind: "klacht",
    patterns: [
      /\b(klacht|klagen|ontevreden|teleurgesteld|boos|schandalig|belachelijk|oplichting|oplichters|bedrog|misleid\w*)\b/i,
      /\b(advocaat|rechtszaak|juridische stappen|aansprakelijk|schadevergoeding|ingebrekestelling|consumentenbond|geschillencommissie)\b/i,
      /\b(klopt niet|fout|verkeerd)\b.{0,30}\b(uitkomst|berekening|prijs|check)\b.{0,60}\b(gevolg|schade|beslissing|getekend)\b/i,
    ],
  },
  {
    kind: "zakelijk",
    patterns: [
      /\b(journalist|redactie|pers|persvraag|interview|artikel over jullie)\b/i,
      /\b(samenwerk\w*|partnerschap|partner worden|data kopen|prijsdata kopen|abonnement voor bedrijven|api-?toegang|investe\w*|overname)\b/i,
      /\b(wij zijn (een )?(installateur|installatiebedrijf|energiecoöperatie|energiecooperatie|gemeente|bedrijf))\b/i,
    ],
  },
  {
    kind: "installateur",
    patterns: [
      // "is <Naam> betrouwbaar", "ervaring met <Naam>", "<Naam> B.V."
      /\b(?:[Ii]s|[Zz]ijn)\s+[A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+)*\s+(betrouwbaar|goed|oké|oke|te vertrouwen|een goede)\b/,
      /\b(?:[Ee]rvaring(?:en)? met|[Rr]eviews? (?:van|over)|[Mm]ening over|[Ww]at vinden jullie van)\s+[A-Z][\w&.-]+/,
      /\b[A-Z][\w&-]+(?:\s+[A-Z][\w&-]+)*\s+(B\.?V\.?|V\.?O\.?F\.?|Installatie(techniek|bedrijf)?|Installaties)\b/,
      /\b(installateur|installatiebedrijf|bedrijf)\b.{0,40}\b(failliet|niet (meer )?bereikbaar|reageert niet|komt afspraak niet na|fouten gemaakt|slecht werk)\b/i,
    ],
  },
];

/** Returns the first escalation that matches, in priority order: privacy, klacht, zakelijk, installateur. */
export function triage(text: string): Escalation | null {
  for (const r of RULES) if (r.patterns.some((p) => p.test(text))) return r.kind;
  return null;
}

/** What the bot says when it hands over. Owner-facing SLA: 5 working days, privacy within 1 month (AVG art. 12). */
export const HANDOVER: Record<Escalation, string> = {
  klacht: "Wat vervelend. Een klacht laten we altijd door een mens bekijken. Laat je e-mailadres en je bericht achter, dan reageren we binnen 5 werkdagen.",
  privacy: "Een privacyverzoek handelen we zorgvuldig af, door een mens. Laat je e-mailadres en je verzoek achter, dan reageren we binnen een maand, meestal veel sneller. Heb je een intrekcode? Dan kun je je offerte ook meteen zelf verwijderen.",
  installateur: "Over specifieke installateurs geven we geen oordeel: we beoordelen prijzen, nooit bedrijven. Gaat het om een probleem met een installateur? Laat je e-mailadres en je vraag achter, dan kijkt een mens mee en reageren we binnen 5 werkdagen.",
  zakelijk: "Leuk dat je contact zoekt. Zakelijke vragen beantwoordt de eigenaar zelf. Laat je e-mailadres en je bericht achter, dan reageren we binnen 5 werkdagen.",
};

// ---- automated mail: loop and bulk protection ------------------------------------------
export function isAutomatedMail(from: string, headers: Record<string, string>): boolean {
  const h = (k: string) => (headers[k.toLowerCase()] ?? "").toLowerCase();
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce|notifications?)@/i.test(from)) return true;
  if (h("auto-submitted") && h("auto-submitted") !== "no") return true;
  if (/bulk|junk|list|auto_reply/.test(h("precedence"))) return true;
  if (h("list-id") || h("list-unsubscribe") || h("x-autoreply") || h("x-autorespond")) return true;
  return false;
}

/** Support reference in mail subjects, e.g. "[KMO-7Q4K2M]". A reply that carries one always goes to a human. */
export const REF_RE = /\[KMO-([A-HJ-NP-Z2-9]{6})\]/;
