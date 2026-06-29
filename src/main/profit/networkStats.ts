import { request } from "undici";
import type { NetworkStats } from "../../core/profit/calc";

let cache: { at: number; stats: NetworkStats } | null = null;
const TTL_MS = 10 * 60 * 1000; // refresh at most every 10 minutes

/**
 * Live BTC price (USD) + network difficulty from blockchain.info. Cached for 10
 * minutes; on failure returns the last good value (or zeros, so the UI can show
 * "price unavailable" and let the user enter it manually). Block reward is the
 * post-2024-halving subsidy (3.125 BTC); update at the next halving (~2028).
 */
export async function getNetworkStats(now = Date.now()): Promise<NetworkStats> {
  if (cache && now - cache.at < TTL_MS) return cache.stats;
  try {
    const [priceRes, diffRes] = await Promise.all([
      request("https://blockchain.info/ticker", { headersTimeout: 8000, bodyTimeout: 8000 }),
      request("https://blockchain.info/q/getdifficulty", { headersTimeout: 8000, bodyTimeout: 8000 }),
    ]);
    // Drain both bodies before any parse can throw, so neither stream leaks.
    const [tickerText, diffText] = await Promise.all([priceRes.body.text(), diffRes.body.text()]);
    const ticker = JSON.parse(tickerText) as Record<string, { last?: number }>;
    const priceUsd = Number(ticker?.["USD"]?.last) || 0;
    const difficulty = Number(diffText.trim()) || 0;
    const stats: NetworkStats = { priceUsd, difficulty, blockRewardBtc: 3.125 };
    if (priceUsd > 0 && difficulty > 0) cache = { at: now, stats };
    return cache?.stats ?? stats;
  } catch {
    return cache?.stats ?? { priceUsd: 0, difficulty: 0, blockRewardBtc: 3.125 };
  }
}
