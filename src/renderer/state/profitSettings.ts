export interface ProfitSettings {
  currency: string; // label e.g. "ريال", "$"
  usdRate: number; // user-currency units per 1 USD (1 => USD)
  electricityPerKwh: number; // in the user's currency
  jPerTh: number; // efficiency (J/TH)
  manualPriceUsd: number; // 0 => use the live price
}

export const PROFIT_KEY = "mcc.profitSettings";

export const PROFIT_DEFAULTS: ProfitSettings = {
  currency: "$",
  usdRate: 1,
  electricityPerKwh: 0.05,
  jPerTh: 18.5,
  manualPriceUsd: 0,
};

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
