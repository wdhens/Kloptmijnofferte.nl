export const VAT_RATE = 0.21;
export const roundTo = (x: number, step: number) => Math.round(x / step) * step;
export const eur = (x: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(x);
