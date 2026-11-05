// Deterministic second pass: any hit blocks the record from being stored.
export type PiiKind = "email" | "phone" | "iban" | "bsn" | "postcode_full" | "ean" | "street_address";

export interface PiiHit { kind: PiiKind; path: string; }

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+31|0031|\b0)[\s-]?(?:6|[1-9]\d{1,2})(?:[\s-]?\d){6,8}\b/;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z]{4}\d{10}\b/;
const POSTCODE_FULL = /\b[1-9]\d{3}\s?(?!SA|SD|SS)[A-Z]{2}\b/;
const EAN = /\b871\d{15}\b/;
const STREET = /\b[A-Z][a-z]+(?:straat|laan|weg|plein|gracht|kade|singel|dijk|hof|dreef|pad)\s+\d+/;
const NINE_DIGITS = /\b\d{9}\b/g;

export function isValidBsn(s: string): boolean {
  if (!/^\d{9}$/.test(s)) return false;
  const d = s.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * (9 - i);
  sum -= d[8];
  return sum % 11 === 0 && sum !== 0;
}

export function isValidIban(s: string): boolean {
  const iban = s.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export function scanText(text: string): PiiKind[] {
  const kinds: PiiKind[] = [];
  if (EMAIL.test(text)) kinds.push("email");
  if (PHONE.test(text)) kinds.push("phone");
  const iban = text.match(IBAN);
  if (iban && isValidIban(iban[0])) kinds.push("iban");
  if (POSTCODE_FULL.test(text)) kinds.push("postcode_full");
  if (EAN.test(text)) kinds.push("ean");
  if (STREET.test(text)) kinds.push("street_address");
  for (const m of text.match(NINE_DIGITS) ?? []) if (isValidBsn(m)) { kinds.push("bsn"); break; }
  return kinds;
}

/** Walk every string in a record that is about to be stored. */
export function scanRecord(value: unknown, path = "$", skip: Set<string> = new Set()): PiiHit[] {
  if (skip.has(path)) return [];
  if (typeof value === "string") return scanText(value).map((kind) => ({ kind, path }));
  if (Array.isArray(value)) return value.flatMap((v, i) => scanRecord(v, `${path}[${i}]`, skip));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => scanRecord(v, `${path}.${k}`, skip));
  return [];
}

export function toPc4(postcode: string | undefined): string | undefined {
  const m = postcode?.match(/\b([1-9]\d{3})/);
  return m?.[1];
}

/**
 * Replace personal data in free text with placeholders, before it reaches a model or a log.
 * Used for chat and support messages. Catches the same kinds as scanText.
 */
export function maskText(text: string): string {
  return text
    .replace(new RegExp(EMAIL.source, "gi"), "[e-mail]")
    .replace(new RegExp(IBAN.source, "g"), (m) => (isValidIban(m) ? "[rekeningnummer]" : m))
    .replace(new RegExp(EAN.source, "g"), "[EAN-code]")
    .replace(new RegExp(PHONE.source, "g"), "[telefoon]")
    .replace(NINE_DIGITS, (m) => (isValidBsn(m) ? "[BSN]" : m))
    .replace(new RegExp(POSTCODE_FULL.source, "g"), (m) => `${m.slice(0, 4)} [..]`)
    .replace(new RegExp(STREET.source, "g"), "[adres]");
}
