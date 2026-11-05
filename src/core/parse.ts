// Quote parser: Claude reads the PDF or photo and returns the fixed schema.
// Small model first; escalate when unsure or when the numbers don't add up.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LINE_CATEGORIES, type ParsedQuote } from "./schema";
import { validateQuote } from "./validate";

export const MODELS = {
  small: "claude-haiku-5-5",
  large: "claude-sonnet-5-5",
} as const;

// USD per million tokens (input, output), from the claude-api reference, 2026-10.
export const PRICES_USD_PER_MTOK: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

const n = () => z.number().nullable();
const s = () => z.string().nullable();

export const QuoteSchema = z.object({
  is_heat_pump_quote: z.boolean(),
  brand: s(), model: s(), meldcode: s(), marketed_kw: n(), energy_label: s(), smart_protocol: s(),
  quote_date: s(), signed_date: s(),
  total_excl_vat: n(), vat_amount: n(), total_incl_vat: n(), stated_subsidy: n(), warranty_years: n(),
  postcode_digits: s(), installer_kvk: s(),
  line_items: z.array(z.object({
    description: z.string(),
    category: z.enum(LINE_CATEGORIES as [string, ...string[]]),
    amount_incl_vat: z.number(),
  })),
  confidence: z.number(),
});

const SYSTEM = `Je leest Nederlandse offertes voor (hybride) warmtepompen en zet ze om in velden.
Regels:
- Neem NOOIT persoonsgegevens over: geen namen, straat of huisnummer, e-mail, telefoon, IBAN, klantnummers of handtekeningen. In line_items.description alleen wat er geleverd wordt, zonder namen.
- postcode_digits: alleen de 4 cijfers van de postcode van het installatieadres, anders null.
- installer_kvk: het KvK-nummer van het installatiebedrijf, anders null.
- Bedragen in euro inclusief 21% btw. total_incl_vat is de prijs VOOR aftrek van subsidie. Een korting is een regel met category "discount" en een negatief bedrag.
- Datums als JJJJ-MM-DD. signed_date alleen als de offerte getekend of bevestigd is.
- Onbekend = null. Verzin niets.
- confidence: 0 tot 1, hoe zeker je bent dat alle bedragen kloppen.
- is_heat_pump_quote: false als dit geen offerte voor een warmtepomp is.`;

export type Media = { data: string; media_type: "application/pdf" | "image/jpeg" | "image/png" };

export interface ParseOutcome {
  quote: ParsedQuote | null;
  model: string;
  cost_usd: number;
  refused: boolean;
  not_a_quote: boolean;
  raw_pc4: string | null;
}

function fileBlock(m: Media): Anthropic.ContentBlockParam {
  return m.media_type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: m.data } }
    : { type: "image", source: { type: "base64", media_type: m.media_type, data: m.data } };
}

export function costUsd(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const [i, o] = PRICES_USD_PER_MTOK[model] ?? [2, 10];
  return (usage.input_tokens * i + usage.output_tokens * o) / 1e6;
}

const nz = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function toParsedQuote(x: z.infer<typeof QuoteSchema>): ParsedQuote {
  return {
    product: "hybrid_heat_pump",
    brand: nz(x.brand), model: nz(x.model), meldcode: nz(x.meldcode), marketed_kw: nz(x.marketed_kw),
    energy_label: nz(x.energy_label), smart_protocol: nz(x.smart_protocol),
    quote_date: x.quote_date ?? "", signed_date: nz(x.signed_date),
    total_excl_vat: nz(x.total_excl_vat), vat_amount: nz(x.vat_amount), total_incl_vat: x.total_incl_vat ?? 0,
    stated_subsidy: nz(x.stated_subsidy), warranty_years: nz(x.warranty_years),
    line_items: x.line_items as ParsedQuote["line_items"],
    pc4: nz(x.postcode_digits)?.match(/^[1-9]\d{3}$/)?.[0],
    installer_kvk: nz(x.installer_kvk)?.replace(/\D/g, "") || undefined,
    confidence: x.confidence,
  };
}

async function runOnce(client: Anthropic, model: string, media: Media) {
  const res = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: model === MODELS.small ? "low" : "medium", format: zodOutputFormat(QuoteSchema) },
    messages: [{ role: "user", content: [fileBlock(media), { type: "text", text: "Lees deze offerte uit." }] }],
  });
  return { res, cost: costUsd(model, res.usage) };
}

export function needsEscalation(q: ParsedQuote): boolean {
  if (q.confidence < 0.75) return true;
  return validateQuote(q).some((i) => i.code === "lines_dont_sum" || i.code === "vat_mismatch" || i.code === "no_total");
}

export async function parseQuote(client: Anthropic, media: Media): Promise<ParseOutcome> {
  let total = 0;
  let last: ParseOutcome | null = null;
  for (const model of [MODELS.small, MODELS.large]) {
    const { res, cost } = await runOnce(client, model, media);
    total += cost;
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      last = { quote: null, model, cost_usd: total, refused: res.stop_reason === "refusal", not_a_quote: false, raw_pc4: null };
      continue;
    }
    const out = res.parsed_output;
    if (!out.is_heat_pump_quote) return { quote: null, model, cost_usd: total, refused: false, not_a_quote: true, raw_pc4: null };
    const quote = toParsedQuote(out);
    last = { quote, model, cost_usd: total, refused: false, not_a_quote: false, raw_pc4: quote.pc4 ?? null };
    if (!needsEscalation(quote)) return last;
  }
  return last!;
}
