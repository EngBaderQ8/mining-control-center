import type { NetworkStats } from "../../../src/core/profit/calc";

let cache: { at: number; stats: NetworkStats } | null = null;
const TTL_MS = 10 * 60 * 1000; // refresh at most every 10 minutes

/**
 * Live BTC price (USD) + difficulty from blockchain.info, using Node's GLOBAL
 * fetch (NOT undici — undici's index initializer crashes on older Node 20.x via
 * `webidl.util.markAsUncloneable`). Cached 10 min; on failure returns the last
 * good value (or zeros so the dashboard shows $0 rather than crashing).
 */
export async function getNetworkStats(now = Date.now()): Promise<NetworkStats> {
  if (cache && now - cache.at < TTL_MS) return cache.stats;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const [priceRes, diffRes] = await Promise.all([
        fetch("https://blockchain.info/ticker", { signal: ctrl.signal }),
        fetch("https://blockchain.info/q/getdifficulty", { signal: ctrl.signal }),
      ]);
      const ticker = (await priceRes.json()) as Record<string, { last?: number }>;
      const diffText = await diffRes.text();
      const priceUsd = Number(ticker?.["USD"]?.last) || 0;
      const difficulty = Number(diffText.trim()) || 0;
      const stats: NetworkStats = { priceUsd, difficulty, blockRewardBtc: 3.125 };
      if (priceUsd > 0 && difficulty > 0) cache = { at: now, stats };
      return cache?.stats ?? stats;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return cache?.stats ?? { priceUsd: 0, difficulty: 0, blockRewardBtc: 3.125 };
  }
}
