import { request } from "undici";
import WebSocket from "ws";
import type { NetworkStats } from "../../core/profit/calc";

/**
 * BTC price + network difficulty.
 *
 * PRICE is LIVE: a Binance WebSocket ticker (btcusdt@ticker) pushes the last price
 * ~once per second, kept in `livePrice`. getNetworkStats() returns it instantly, so the
 * UI can poll every couple seconds with zero rate-limit risk. If the socket is down
 * (or blocked), we fall back to a short-cached blockchain.info price.
 *
 * DIFFICULTY changes only ~every two weeks, so it's fetched from blockchain.info at most
 * every 10 minutes. Block reward is the post-2024-halving subsidy (3.125 BTC).
 */

let livePrice = 0;
let livePriceAt = 0;
let feedStarted = false;

function startPriceFeed(): void {
  if (feedStarted) return;
  feedStarted = true;
  connectPriceFeed();
}

function connectPriceFeed(): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");
  } catch {
    setTimeout(connectPriceFeed, 15_000);
    return;
  }
  ws.on("message", (data: WebSocket.RawData) => {
    try {
      const m = JSON.parse(data.toString()) as { c?: string };
      const p = Number(m.c);
      if (p > 0) {
        livePrice = p;
        livePriceAt = Date.now();
      }
    } catch {
      /* ignore malformed frame */
    }
  });
  const retry = (): void => {
    try {
      ws.removeAllListeners();
      ws.terminate();
    } catch {
      /* ignore */
    }
    setTimeout(connectPriceFeed, 15_000); // blockchain.info REST covers the gap
  };
  ws.on("close", retry);
  ws.on("error", retry);
}

let diffCache = { at: 0, difficulty: 0 };
let restPrice = { at: 0, price: 0 };
const DIFF_TTL = 10 * 60 * 1000;
const REST_PRICE_TTL = 30 * 1000;

export async function getNetworkStats(now = Date.now()): Promise<NetworkStats> {
  startPriceFeed();

  // Difficulty: rarely changes — refresh at most every 10 minutes.
  if (now - diffCache.at > DIFF_TTL) {
    try {
      const r = await request("https://blockchain.info/q/getdifficulty", { headersTimeout: 8000, bodyTimeout: 8000 });
      const d = Number((await r.body.text()).trim());
      if (d > 0) diffCache = { at: now, difficulty: d };
    } catch {
      /* keep the last good difficulty */
    }
  }

  // Price: prefer the live WS feed (fresh within 60s); else a short-cached REST price.
  let priceUsd = now - livePriceAt < 60_000 ? livePrice : 0;
  if (priceUsd <= 0) {
    if (now - restPrice.at > REST_PRICE_TTL) {
      try {
        const r = await request("https://blockchain.info/ticker", { headersTimeout: 8000, bodyTimeout: 8000 });
        const ticker = JSON.parse(await r.body.text()) as Record<string, { last?: number }>;
        const p = Number(ticker?.["USD"]?.last) || 0;
        if (p > 0) restPrice = { at: now, price: p };
      } catch {
        /* keep the last good REST price */
      }
    }
    priceUsd = restPrice.price;
  }

  return { priceUsd, difficulty: diffCache.difficulty, blockRewardBtc: 3.125 };
}
