import type { Device, DeviceStatus } from "../model/device";
import { btcPerDay, type NetworkStats } from "../profit/calc";

const HOT_C = 80;

/**
 * Build the daily Telegram summary text from a fleet snapshot. Pure — date is
 * passed in. Covers hashrate, online/offline, hot devices, and an estimated
 * BTC/USD per day (no electricity, since that's a renderer-side setting).
 */
export function buildDailyReport(
  devices: Device[],
  statuses: DeviceStatus[],
  net: NetworkStats,
  now: number,
): string {
  const byId = new Map(statuses.map((s) => [s.deviceId, s]));
  let online = 0;
  let offline = 0;
  let hot = 0;
  let ths = 0;
  for (const d of devices) {
    const s = byId.get(d.id);
    if (!s || s.state === "offline") offline++;
    else online++;
    if (s) ths += s.hashrateTHs;
    if (s && s.maxTempC >= HOT_C) hot++;
  }
  const btc = btcPerDay(ths, net);
  const usd = btc * net.priceUsd;
  const date = new Date(now).toISOString().slice(0, 10);
  const lines = [
    `📊 تقرير التعدين اليومي — ${date}`,
    `🔥 الهاش الكلي: ${ths.toLocaleString(undefined, { maximumFractionDigits: 0 })} TH/s`,
    `🟢 شغّال: ${online} / ${devices.length} جهاز`,
  ];
  if (offline > 0) lines.push(`🔴 غير متصل: ${offline}`);
  if (hot > 0) lines.push(`🌡️ ساخن (≥${HOT_C}°): ${hot}`);
  if (net.priceUsd > 0 && btc > 0)
    lines.push(`₿ تقديري: ${btc.toFixed(5)} BTC (~$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}) /يوم`);
  return lines.join("\n");
}
