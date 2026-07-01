/** Live Bitcoin network figures used to value mined output. */
export interface NetworkStats {
  priceUsd: number; // BTC price in USD
  difficulty: number; // current network difficulty
  blockRewardBtc: number; // block subsidy (+ optional avg fees)
}

export interface ProfitInputs {
  hashrateTHs: number; // total fleet hashrate (TH/s)
  powerKw: number; // total power draw (kW)
  electricityPerKwh: number; // electricity price per kWh (in the user's currency)
  usdRate: number; // how many of the user's currency units per 1 USD (1 => USD)
  rentPerDay?: number; // fixed rent cost per day (monthly rent / 30), 0 if none
}

export interface ProfitResult {
  btcPerDay: number;
  revenuePerDay: number; // in the user's currency
  costPerDay: number; // electricity only
  rentPerDay: number; // fixed rent
  profitPerDay: number; // revenue − electricity − rent
  revenuePerMonth: number;
  costPerMonth: number;
  rentPerMonth: number;
  profitPerMonth: number;
  marginPct: number; // profit / revenue, 0..100
}

const HASHES_PER_TH = 1e12;
const SECONDS_PER_DAY = 86400;
const TWO_POW_32 = 2 ** 32;

/**
 * Bitcoin mined per day for a given hashrate:
 *   BTC/day = hashrate(H/s) × seconds/day × blockReward / (difficulty × 2^32)
 * This is the standard expected-value formula (ignores luck/variance).
 */
export function btcPerDay(hashrateTHs: number, net: NetworkStats): number {
  if (hashrateTHs <= 0 || net.difficulty <= 0) return 0;
  const hps = hashrateTHs * HASHES_PER_TH;
  return (hps * SECONDS_PER_DAY * net.blockRewardBtc) / (net.difficulty * TWO_POW_32);
}

/** Full revenue/cost/profit in the user's currency (per day and per ~30-day month). */
export function computeProfit(net: NetworkStats, inp: ProfitInputs): ProfitResult {
  const btc = btcPerDay(inp.hashrateTHs, net);
  const revenuePerDay = btc * net.priceUsd * inp.usdRate;
  const costPerDay = inp.powerKw * 24 * inp.electricityPerKwh;
  const rentPerDay = Math.max(0, inp.rentPerDay ?? 0);
  const profitPerDay = revenuePerDay - costPerDay - rentPerDay;
  return {
    btcPerDay: btc,
    revenuePerDay,
    costPerDay,
    rentPerDay,
    profitPerDay,
    revenuePerMonth: revenuePerDay * 30,
    costPerMonth: costPerDay * 30,
    rentPerMonth: rentPerDay * 30,
    profitPerMonth: profitPerDay * 30,
    marginPct: revenuePerDay > 0 ? (profitPerDay / revenuePerDay) * 100 : 0,
  };
}

/**
 * Estimate total power (kW) from hashrate and efficiency.
 *   power(W) = efficiency(J/TH) × hashrate(TH/s)   [J/TH × TH/s = W]
 * Default efficiency suits Antminer S19 XP+ Hyd (~18.5 J/TH).
 */
export function powerKwFromHashrate(hashrateTHs: number, jPerTh = 18.5): number {
  return (hashrateTHs * jPerTh) / 1000;
}
