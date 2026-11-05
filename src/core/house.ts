// House facts from open BAG data (looked up in the browser, never sent to us).
export interface HouseFacts { bouwjaar?: number; oppervlakte_m2?: number; gebruiksdoel?: string[]; }

export interface HouseAdvice { isde_build_year_ok: boolean | null; notes: string[]; }

export function adviseHouse(h: HouseFacts): HouseAdvice {
  const notes: string[] = [];
  let ok: boolean | null = null;
  if (h.bouwjaar) {
    ok = h.bouwjaar < 2019;
    notes.push(ok
      ? `Bouwjaar ${h.bouwjaar}: je woning voldoet aan de ISDE-eis 'gebouwd vóór 2019'.`
      : `Bouwjaar ${h.bouwjaar}: voor woningen vanaf 2019 geldt de ISDE-subsidie meestal niet.`);
    if (h.bouwjaar < 1975) notes.push("Oudere woning: vraag of isoleren eerst verstandig is. Een hybride warmtepomp werkt beter in een goed geïsoleerd huis.");
  }
  if (h.gebruiksdoel && !h.gebruiksdoel.some((d) => d.toLowerCase().includes("woon")))
    notes.push("Volgens het Kadaster is dit geen woonfunctie. ISDE voor woningeigenaren geldt dan mogelijk niet.");
  return { isde_build_year_ok: ok, notes };
}
