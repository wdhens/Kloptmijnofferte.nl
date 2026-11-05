// Knowledge base for the chat, email replies and the FAQ page.
// Owned by the Support function; tone follows brand-and-tone (Growth). Dutch, "je", B1, numbers over adjectives.
// Facts about ISDE come from src/core/data/isde_air_water_heat_pump.json (Data and quality).
// Learned entries are added at runtime from D1 (table kb_learned) by the weekly support loop.

import isde from "../data/isde_air_water_heat_pump.json";
import { computeIsde } from "../isde";

const eurNl = (x: number) => `€${x.toLocaleString("nl-NL")}`;
const r26 = isde.rules.find((r) => r.year === 2026)!;
const r27 = isde.rules.find((r) => r.year === 2027)!;
// The worked example uses the RVO meldcode KA21789 (sold as 6 kW, listed as 4 kW).
const example26 = computeIsde({ subsidiable_kw: 4, energy_label: "A+++", purchase_date: "2026-06-01" }).amount!;

export type Topic = "check" | "privacy" | "prijzen" | "subsidie" | "warmtepomp" | "over_ons" | "contact";

export interface KbEntry {
  id: string;
  topic: Topic;
  question: string;
  answer: string;
  keywords: string[];
  links?: { label: string; href: string }[];
  source?: "human" | "learned";
}

export const KB: KbEntry[] = [
  // ---- de check ---------------------------------------------------------------
  {
    id: "check-wat", topic: "check",
    question: "Wat doet kloptmijnofferte.nl?",
    answer: "Je uploadt je offerte voor een hybride warmtepomp. Wij lezen de bedragen uit en laten zien waar je prijs zit ten opzichte van de middenprijs. Je krijgt ook vragen die je je installateur kunt stellen en een berekening van je ISDE-subsidie. We zijn een tweede mening, geen installateur.",
    keywords: ["wat", "doen", "jullie", "werkt", "hoe", "check", "offerte", "tweede mening"],
    links: [{ label: "Check je offerte", href: "/" }],
  },
  {
    id: "check-kosten", topic: "check",
    question: "Wat kost de check?",
    answer: "De check kost je niets. We verdienen later aan prijsoverzichten voor bedrijven, opgebouwd uit anonieme offertes. We krijgen geen geld van installateurs en verkopen geen leads.",
    keywords: ["kost", "kosten", "betalen", "prijs check", "gratis", "verdienen", "verdienmodel"],
  },
  {
    id: "check-bestand", topic: "check",
    question: "Welke bestanden kan ik uploaden?",
    answer: "Een pdf, jpg of png van maximaal 10 MB. Een foto werkt ook, als de bedragen goed leesbaar zijn. Lukt het niet? Probeer dan de pdf of een scherpere foto bij daglicht.",
    keywords: ["bestand", "upload", "uploaden", "pdf", "foto", "jpg", "png", "mb", "lukt niet", "fout", "lezen"],
  },
  {
    id: "check-duur", topic: "check",
    question: "Hoe lang duurt de check?",
    answer: "Meestal minder dan 2 minuten. Het uitlezen van de offerte duurt het langst, vaak 20 tot 60 seconden.",
    keywords: ["lang", "duur", "duurt", "tijd", "snel", "minuten", "wachten"],
  },
  {
    id: "check-product", topic: "check",
    question: "Kan ik ook een offerte voor zonnepanelen, een thuisbatterij of isolatie checken?",
    answer: "Nog niet. We beginnen met hybride warmtepompen. Zonnepanelen, thuisbatterijen, isolatie en volledig elektrische warmtepompen volgen later. Laat je e-mailadres achter op de site als je bericht wilt krijgen.",
    keywords: ["zonnepanelen", "batterij", "thuisbatterij", "isolatie", "all-electric", "volledig elektrisch", "andere", "ook"],
  },
  {
    id: "check-uitkomst", topic: "prijzen",
    question: "Hoe moet ik de uitkomst lezen?",
    answer: "Je ziet je prijs naast de middenprijs: de helft van de offertes is duurder, de helft goedkoper. De bandbreedte loopt van het goedkoopste kwart tot het duurste kwart van de offertes. Boven de bandbreedte betekent niet dat de offerte fout is. Vraag dan wat er in de prijs zit, bijvoorbeeld extra leidingwerk of een nieuwe elektragroep.",
    keywords: ["uitkomst", "resultaat", "middenprijs", "bandbreedte", "duur", "te duur", "boven", "onder", "betekent", "lezen"],
  },
  {
    id: "check-weinig-data", topic: "prijzen",
    question: "Waarop is de middenprijs gebaseerd?",
    answer: "Op offertes van andere huiseigenaren. We tonen een middenprijs pas als die rust op minstens 5 offertes van minstens 3 installateurs, afgerond op €50. Hebben we die nog niet, dan gebruiken we openbare prijsindicaties en zeggen we dat erbij.",
    keywords: ["gebaseerd", "waarop", "betrouwbaar", "hoeveel offertes", "data", "vergelijken", "bron", "indicatie"],
    links: [{ label: "Prijzen hybride warmtepomp", href: "/prijzen/hybride-warmtepomp" }],
  },
  {
    id: "check-oordeel-installateur", topic: "prijzen",
    question: "Kunnen jullie zeggen of mijn installateur betrouwbaar is?",
    answer: "Nee. We beoordelen prijzen, nooit bedrijven, en we noemen geen namen van installateurs. Wel kun je zelf checken of het bedrijf ingeschreven staat bij de KvK en of de warmtepomp op de RVO-meldcodelijst staat. Vraag ook naar referenties bij jou in de buurt.",
    keywords: ["installateur", "betrouwbaar", "bedrijf", "reviews", "aanraden", "aanbevelen", "welke installateur", "goede installateur", "ervaring"],
  },
  // ---- privacy -------------------------------------------------------------------
  {
    id: "privacy-bestand", topic: "privacy",
    question: "Wat doen jullie met mijn offerte?",
    answer: "We lezen je offerte uit en bewaren het bestand niet. Namen, adressen, telefoonnummers, e-mailadressen en rekeningnummers slaan we niet op. Van je postcode bewaren we alleen de 4 cijfers.",
    keywords: ["offerte", "bewaren", "opslaan", "bestand", "gegevens", "persoonsgegevens", "privacy", "veilig", "naam", "adres"],
    links: [{ label: "Privacyuitleg", href: "/privacy" }],
  },
  {
    id: "privacy-toestemming", topic: "privacy",
    question: "Moet ik toestemming geven om mijn offerte te laten meetellen?",
    answer: "Nee. De check werkt ook zonder. Alleen als je het vakje aanvinkt, telt je offerte anoniem mee in de prijsoverzichten. Zo help je de volgende huiseigenaar.",
    keywords: ["toestemming", "meetellen", "vakje", "aanvinken", "delen", "anoniem", "verplicht", "hergebruik"],
  },
  {
    id: "privacy-intrekken", topic: "privacy",
    question: "Hoe trek ik mijn toestemming in?",
    answer: "Gaf je toestemming? Dan kreeg je een intrekcode van 6 tekens. Daarmee laat je je offerte 30 dagen lang verwijderen uit onze gegevens. Na 30 dagen is je offerte niet meer aan jou te koppelen, ook niet door ons.",
    keywords: ["intrekken", "verwijderen", "wissen", "intrekcode", "code", "terugtrekken", "toestemming"],
  },
  {
    id: "privacy-cookies", topic: "privacy",
    question: "Gebruiken jullie cookies?",
    answer: "Nee. We tellen alleen hoeveel mensen elke stap bereiken, zonder te weten wie. Ook deze chat bewaart je gesprek niet.",
    keywords: ["cookies", "volgen", "tracking", "analytics", "bijhouden"],
  },
  {
    id: "privacy-chat", topic: "privacy",
    question: "Wat gebeurt er met wat ik in de chat typ?",
    answer: "De chat is een AI-assistent. We halen e-mailadressen, telefoonnummers, adressen en rekeningnummers uit je bericht voordat de assistent het leest. We bewaren je gesprek niet. We tellen alleen welke onderwerpen vaak terugkomen, in een paar woorden zonder persoonsgegevens, om de veelgestelde vragen te verbeteren.",
    keywords: ["chat", "ai", "robot", "bot", "mens", "gesprek", "bewaard", "assistent", "claude"],
  },
  {
    id: "privacy-verzoek", topic: "privacy",
    question: "Ik wil mijn gegevens inzien of laten verwijderen.",
    answer: "Dat kan. Van de check bewaren we geen gegevens die naar jou wijzen. Heb je een intrekcode, dan verwijder je je offerte daarmee zelf. Heb je je e-mailadres achtergelaten? Stuur dan je verzoek via het contactformulier. We reageren binnen een maand, meestal veel sneller.",
    keywords: ["avg", "gdpr", "inzage", "inzien", "verwijderen", "gegevens", "recht", "verzoek", "afmelden", "uitschrijven"],
    links: [{ label: "Contact", href: "/contact" }],
  },
  // ---- subsidie --------------------------------------------------------------------
  {
    id: "isde-hoeveel", topic: "subsidie",
    question: "Hoeveel ISDE-subsidie krijg ik voor een hybride warmtepomp?",
    answer: `Koop je in 2026, dan is het ${eurNl(r26.base)} plus ${eurNl(r26.per_kw_subsidiable)} per kW, plus ${eurNl(r26["label_bonus_A+++"])} als de warmtepomp energielabel A+++ heeft. Het gaat om het vermogen uit de meldcodelijst van RVO, dat kan lager zijn dan het vermogen in de folder. Voorbeeld: een model dat als 6 kW wordt verkocht, staat op de lijst als 4 kW en krijgt dan ${eurNl(example26)}. Onze check rekent het voor je uit.`,
    keywords: ["isde", "subsidie", "hoeveel", "bedrag", "krijg", "terug", "rvo", "kw", "a+++"],
    links: [{ label: "Bereken je subsidie", href: "/bereken" }, { label: "RVO: ISDE in 2026", href: "https://www.rvo.nl/subsidies-financiering/isde/isde-wat-wijzigt-er-2026" }],
  },
  {
    id: "isde-2027", topic: "subsidie",
    question: "Verandert de subsidie in 2027?",
    answer: `Ja, dat is aangekondigd maar nog niet definitief. Het bedrag per kW gaat naar ${eurNl(r27.per_kw_subsidiable)}. De bonus voor A+++ wordt ${eurNl(r27["label_bonus_A+++"])} en er komt ${eurNl(r27.smart_bonus)} bij voor een slimme aansturing. Teken je uiterlijk 31 december 2026 en wordt de warmtepomp in 2027 geplaatst? Dan geldt het bedrag van 2026. Bewaar de getekende offerte of opdrachtbevestiging als bewijs.`,
    keywords: ["2027", "volgend jaar", "verandert", "lager", "minder", "wachten", "wijziging", "overgang"],
    links: [{ label: "RVO: ISDE in 2027", href: "https://www.rvo.nl/subsidies-financiering/isde/isde-wat-wijzigt-er-2027" }],
  },
  {
    id: "isde-voorwaarden", topic: "subsidie",
    question: "Wat zijn de voorwaarden voor ISDE?",
    answer: "De belangrijkste: de warmtepomp staat op de meldcodelijst van RVO, een bedrijf installeert hem, je huis is gebouwd vóór 1 januari 2019, de meldcode staat op de factuur en je vraagt de subsidie aan binnen 24 maanden na installatie. Je vraagt zelf aan bij RVO, na de installatie.",
    keywords: ["voorwaarden", "eisen", "aanvragen", "wanneer", "bouwjaar", "2019", "factuur", "24 maanden", "zelf"],
    links: [{ label: "RVO: ISDE", href: "https://www.rvo.nl/subsidies-financiering/isde" }],
  },
  {
    id: "isde-meldcode", topic: "subsidie",
    question: "Wat is een meldcode?",
    answer: "Een code van RVO voor elk warmtepompmodel dat subsidie kan krijgen, bijvoorbeeld KA21789. Zonder meldcode op de factuur krijg je geen ISDE. Staat er geen meldcode op je offerte? Vraag je installateur ernaar.",
    keywords: ["meldcode", "ka", "code", "rvo lijst", "model", "factuur"],
  },
  // ---- warmtepomp ---------------------------------------------------------------------
  {
    id: "hybride-wat", topic: "warmtepomp",
    question: "Wat is een hybride warmtepomp?",
    answer: "Een warmtepomp die samenwerkt met je cv-ketel. De warmtepomp verwarmt het huis zolang dat lukt, de ketel springt bij op koude dagen en levert meestal het warme water. Je blijft dus op het gas, maar gebruikt er veel minder van.",
    keywords: ["hybride", "wat is", "warmtepomp", "cv-ketel", "ketel", "werkt", "uitleg"],
  },
  {
    id: "hybride-besparing", topic: "warmtepomp",
    question: "Hoeveel bespaar ik met een hybride warmtepomp?",
    answer: "Gemiddeld gaat je gasverbruik voor verwarming met 60% tot 75% omlaag, maar je stroomverbruik gaat omhoog. Wat je netto overhoudt hangt af van je huis en de energieprijzen. Op de rekenpagina vul je je eigen verbruik in en zie je de besparing en terugverdientijd met de actuele tarieven van het CBS.",
    keywords: ["besparen", "besparing", "terugverdientijd", "terugverdienen", "gas", "stroom", "rendement", "loont", "kosten per jaar"],
    links: [{ label: "Bereken je besparing", href: "/bereken" }],
  },
  {
    id: "hybride-onderdelen", topic: "warmtepomp",
    question: "Wat hoort er in een offerte voor een hybride warmtepomp?",
    answer: "Vaak: de warmtepomp, montage, een aansluitset en leidingwerk, waterzijdig inregelen, soms een nieuwe elektragroep, de meldcode en de garantie. Ontbreekt er iets, vraag dan of het nog extra kost. Onze check geeft je vragen voor je installateur.",
    keywords: ["onderdelen", "offerte", "hoort", "inbegrepen", "inregelen", "elektragroep", "garantie", "montage", "ontbreekt"],
  },
  // ---- over ons en contact -------------------------------------------------------------
  {
    id: "over-onafhankelijk", topic: "over_ons",
    question: "Zijn jullie onafhankelijk?",
    answer: "Ja. We krijgen geen geld van installateurs, verkopen geen leads en vragen geen offertes voor je aan. We beoordelen prijzen, nooit bedrijven.",
    keywords: ["onafhankelijk", "commissie", "provisie", "leads", "installateur betaalt", "wie", "achter", "eerlijk"],
  },
  {
    id: "over-offertes-aanvragen", topic: "over_ons",
    question: "Kunnen jullie offertes voor me aanvragen of een installateur sturen?",
    answer: "Nee, dat doen we bewust niet. Dan zouden we niet meer onafhankelijk zijn. Je vraagt zelf offertes aan, bijvoorbeeld bij 2 of 3 installateurs, en checkt ze daarna bij ons.",
    keywords: ["aanvragen", "offertes aanvragen", "installateur sturen", "regelen", "bemiddelen", "doorverwijzen", "contact met installateur"],
  },
  {
    id: "contact", topic: "contact",
    question: "Hoe neem ik contact op?",
    answer: "Via het contactformulier of per mail. Een vraag die we uit onze uitleg kunnen beantwoorden, krijg je meestal binnen een paar minuten terug. Bij een klacht of een privacyverzoek kijkt een mens mee. Dan reageren we binnen 5 werkdagen.",
    keywords: ["contact", "mail", "bellen", "telefoon", "mens", "medewerker", "klacht", "vraag stellen"],
    links: [{ label: "Contact", href: "/contact" }],
  },
];

// ---- retrieval ------------------------------------------------------------------------
const STOP = new Set("de het een en of ik je jij mijn is zijn van in op te voor met wat hoe dat dit er bij als aan om ook nog niet wel kan mag moet wil heb hebben dan maar".split(" "));

export function tokens(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+\- ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Simple keyword score; used for the no-model fallback and to rank entries for the prompt. */
export function search(query: string, entries: KbEntry[] = KB, limit = 3): { entry: KbEntry; score: number }[] {
  const q = tokens(query);
  const qs = new Set(q), qText = ` ${q.join(" ")} `;
  return entries
    .map((entry) => {
      let score = 0;
      for (const k of entry.keywords) {
        const kt = tokens(k);
        if (kt.length > 1 ? qText.includes(` ${kt.join(" ")} `) : kt.some((t) => qs.has(t) || [...qs].some((w) => w.length > 4 && (w.startsWith(t) || t.startsWith(w)))))
          score += kt.length > 1 ? 2 : 1;
      }
      for (const t of tokens(entry.question)) if (qs.has(t)) score += 0.5;
      return { entry, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function kbAsPrompt(entries: KbEntry[]): string {
  return entries.map((e) => `[${e.id}] V: ${e.question}\nA: ${e.answer}${e.links?.length ? `\nLinks: ${e.links.map((l) => `${l.label} (${l.href})`).join(", ")}` : ""}`).join("\n\n");
}
