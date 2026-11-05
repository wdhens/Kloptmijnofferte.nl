// Turns stored quotes into publishable cells. Never min, max or single quotes.
import { roundTo } from "./money";

export interface StoredQuoteRow { cell: string; total_incl_vat: number; installer_key: string | null; uploader_key: string; }
export interface AggregateCell { cell: string; n: number; p25: number; median: number; p75: number; }

export const K_MIN = 5;
export const INSTALLERS_MIN = 3;

export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function aggregate(rows: StoredQuoteRow[]): AggregateCell[] {
  const byCell = new Map<string, StoredQuoteRow[]>();
  for (const r of rows) byCell.set(r.cell, [...(byCell.get(r.cell) ?? []), r]);
  const out: AggregateCell[] = [];
  for (const [cell, rs] of byCell) {
    const uploaders = new Set(rs.map((r) => r.uploader_key)).size;
    const installers = new Set(rs.map((r) => r.installer_key).filter(Boolean)).size;
    if (uploaders < K_MIN || installers < INSTALLERS_MIN) continue;
    const s = rs.map((r) => r.total_incl_vat).sort((a, b) => a - b);
    out.push({ cell, n: rs.length, p25: roundTo(quantile(s, 0.25), 50), median: roundTo(quantile(s, 0.5), 50), p75: roundTo(quantile(s, 0.75), 50) });
  }
  return out.sort((a, b) => a.cell.localeCompare(b.cell));
}
