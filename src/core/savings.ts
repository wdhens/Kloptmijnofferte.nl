// Yearly savings and payback for a hybrid heat pump. Deterministic, open data only.
import tariffsSeed from "./data/energy_tariffs.json";
import A from "./data/hybrid_assumptions.json";

export interface Tariffs { gas_per_m3: number; electricity_per_kwh: number; as_of: string; source: string; }

export const seedTariffs = (): Tariffs => ({
  gas_per_m3: tariffsSeed.gas_delivery_per_m3 + tariffsSeed.gas_energy_tax_per_m3,
  electricity_per_kwh: tariffsSeed.electricity_delivery_per_kwh + tariffsSeed.electricity_energy_tax_per_kwh,
  as_of: tariffsSeed.as_of,
  source: tariffsSeed.source,
});

export interface SavingsInput { gas_m3_per_year: number; net_price?: number; tariffs?: Tariffs; }

export interface SavingsScenario {
  gas_saved_m3: number;
  extra_kwh: number;
  saving_per_year: number;
  payback_years: number | null;
}

export interface SavingsResult { low: SavingsScenario; study: SavingsScenario; tariffs: Tariffs; assumptions: typeof A; }

function scenario(share: number, gas: number, t: Tariffs, net?: number): SavingsScenario {
  const gas_saved_m3 = gas * share;
  const heat_kwh = (gas_saved_m3 * A.gas_mj_per_m3 * A.boiler_efficiency) / 3.6;
  const extra_kwh = heat_kwh / A.scop;
  const saving = gas_saved_m3 * t.gas_per_m3 - extra_kwh * t.electricity_per_kwh;
  return {
    gas_saved_m3: Math.round(gas_saved_m3),
    extra_kwh: Math.round(extra_kwh),
    saving_per_year: Math.round(saving),
    payback_years: net != null && saving > 0 ? Math.round((net / saving) * 10) / 10 : null,
  };
}

export function computeSavings(input: SavingsInput): SavingsResult {
  const t = input.tariffs ?? seedTariffs();
  return {
    low: scenario(A.gas_saving_share.low, input.gas_m3_per_year, t, input.net_price),
    study: scenario(A.gas_saving_share.study, input.gas_m3_per_year, t, input.net_price),
    tariffs: t,
    assumptions: A,
  };
}

/** Map a CBS 85592NED OData row to tariffs, matching columns by their titles. */
export function tariffsFromCbs(
  props: { Key: string; Title: string; ParentID?: number | null; ID?: number }[],
  row: Record<string, unknown>,
  period: string,
): Tariffs | null {
  const groups = new Map(props.filter((p) => !p.Key).map((p) => [p.ID, p.Title.toLowerCase()]));
  const find = (group: string, title: string) => {
    const p = props.find((x) => x.Key && x.Title.toLowerCase().startsWith(title) && (groups.get(x.ParentID ?? -1) ?? "").includes(group));
    const v = p ? Number(row[p.Key]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const gd = find("aardgas", "variabel leveringstarief contractprijs");
  const gt = find("aardgas", "energiebelasting");
  const ed = find("elektriciteit", "variabel leveringstarief contractprijs");
  const et = find("elektriciteit", "energiebelasting");
  if ([gd, gt, ed, et].some((v) => v == null)) return null;
  return { gas_per_m3: gd! + gt!, electricity_per_kwh: ed! + et!, as_of: period, source: tariffsSeed.source };
}
