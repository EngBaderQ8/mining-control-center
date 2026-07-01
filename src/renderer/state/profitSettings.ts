/** Fallback efficiency (J/TH) for a model NOT in the catalog. The app reads each
 *  known model's real efficiency automatically; this only covers unrecognised models. */
export const FALLBACK_JPERTH = 25;

export interface ProfitSettings {
  currency: string; // label e.g. "ريال", "$"
  usdRate: number; // user-currency units per 1 USD (1 => USD)
  electricityPerKwh: number; // GLOBAL default price, in the user's currency
  manualPriceUsd: number; // 0 => use the live price
  // Per-site overrides (keyed by siteId). Rent is a MONTHLY amount in the user's
  // currency; electricity overrides the global per-kWh price for that site only.
  rentPerMonthBySite?: Record<string, number>;
  electricityBySite?: Record<string, number>;
}

export const PROFIT_KEY = "mcc.profitSettings";

export const PROFIT_DEFAULTS: ProfitSettings = {
  currency: "$",
  usdRate: 1,
  electricityPerKwh: 0.05,
  manualPriceUsd: 0,
  rentPerMonthBySite: {},
  electricityBySite: {},
};

/** Electricity price to use for a site: its override if set (>0), else the global. */
export function siteElectricity(s: ProfitSettings, siteId: string): number {
  const o = s.electricityBySite?.[siteId];
  return o !== undefined && o > 0 ? o : s.electricityPerKwh;
}

/** Monthly rent for a site (never negative; 0 if unset). */
export function siteRentMonthly(s: ProfitSettings, siteId: string): number {
  return Math.max(0, s.rentPerMonthBySite?.[siteId] ?? 0);
}

export function loadProfitSettings(): ProfitSettings {
  try {
    const raw = localStorage.getItem(PROFIT_KEY);
    if (raw) return { ...PROFIT_DEFAULTS, ...(JSON.parse(raw) as Partial<ProfitSettings>) };
  } catch {
    /* ignore */
  }
  return PROFIT_DEFAULTS;
}

export function saveProfitSettings(s: ProfitSettings): void {
  try {
    localStorage.setItem(PROFIT_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Approximate recent BTC difficulty — fallback when the live value is missing. */
export const FALLBACK_DIFFICULTY = 9e13;

export const money = (n: number, cur: string): string =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${cur}`;
