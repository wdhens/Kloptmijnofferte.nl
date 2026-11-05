// Structured form of one parsed quote. Only these fields are ever stored.
export type LineCategory =
  | "heat_pump"
  | "labour"
  | "connection_kit_materials"
  | "hydraulic_balancing"
  | "electrical_group"
  | "flue_replacement"
  | "thermostat"
  | "work_at_height"
  | "drilling"
  | "extra_pipe"
  | "discount"
  | "other";

export interface LineItem {
  description: string;
  category: LineCategory;
  amount_incl_vat: number;
}

export interface ParsedQuote {
  product: "hybrid_heat_pump";
  brand?: string;
  model?: string;
  meldcode?: string;
  marketed_kw?: number;
  subsidiable_kw?: number;
  energy_label?: string;
  smart_protocol?: string;
  quote_date: string; // YYYY-MM-DD
  signed_date?: string;
  total_excl_vat?: number;
  vat_amount?: number;
  total_incl_vat: number;
  stated_subsidy?: number;
  warranty_years?: number;
  line_items: LineItem[];
  pc4?: string;
  installer_kvk?: string; // never stored raw, only as keyed hash
  confidence: number; // 0..1, model's own estimate
}

export const LINE_CATEGORIES: LineCategory[] = [
  "heat_pump", "labour", "connection_kit_materials", "hydraulic_balancing", "electrical_group",
  "flue_replacement", "thermostat", "work_at_height", "drilling", "extra_pipe", "discount", "other",
];
