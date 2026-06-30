import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

/** A per-account snapshot the incident detector compares across runs. */
export interface AcctSnapshot {
  id: string;
  email: string;
  devices: number;
  online: number;
  hashrate: number;
}

export interface AcctState {
  online: number;
  hashrate: number;
  baselineHashrate: number; // slowly-decaying high-water mark (catches gradual decline)
  lastAlertAt: number;
}
export type IncidentState = Record<string, AcctState>;

export interface Incident {
  acctId: string;
  email: string;
  message: string;
}

/**
 * Detect NEW cross-account incidents. Fires on a sudden mass-offline (≥3 devices AND
 * ≥20% of the fleet dropped vs the previous run) or a hashrate crash of ≥25% measured
 * against a slowly-decaying HIGH-WATER baseline — so a GRADUAL decline that never trips
 * the threshold in a single 2-min step is still caught as it accumulates. A per-account
 * cooldown stops a flapping site from spamming the owner. Pure + deterministic.
 */
export function detectIncidents(
  accounts: AcctSnapshot[],
  prev: IncidentState,
  now: number,
  cooldownMs = 30 * 60 * 1000,
): { incidents: Incident[]; state: IncidentState } {
  const state: IncidentState = {};
  const incidents: Incident[] = [];
  for (const a of accounts) {
    const p = prev[a.id];
    const last = p?.lastAlertAt ?? 0;
    // High-water baseline that decays ~3%/run, so it forgets a genuine planned
    // reduction within ~1.5h but holds long enough to catch a slow bleed.
    const baseline = Math.max(a.hashrate, (p?.baselineHashrate ?? a.hashrate) * 0.97);
    let fired = false;
    if (p && now - last >= cooldownMs) {
      const drop = p.online - a.online;
      const hashDrop = baseline > 0 ? 1 - a.hashrate / baseline : 0;
      if (drop >= 3 && drop >= a.devices * 0.2) {
        incidents.push({
          acctId: a.id,
          email: a.email,
          message: `⚠️ ${a.email}: ${drop} جهاز هبط (${a.online}/${a.devices} شغّال الآن)`,
        });
        fired = true;
      } else if (hashDrop >= 0.25 && a.online > 0) {
        incidents.push({
          acctId: a.id,
          email: a.email,
          message: `📉 ${a.email}: الهاش هبط ${Math.round(hashDrop * 100)}% (${Math.round(a.hashrate)} TH/s)`,
        });
        fired = true;
      }
    }
    state[a.id] = {
      online: a.online,
      hashrate: a.hashrate,
      baselineHashrate: baseline,
      lastAlertAt: fired ? now : last,
    };
  }
  return { incidents, state };
}

// ——— Owner Telegram config (persisted on the server, in dataDir) ———

export interface OwnerAlertConfig {
  token: string;
  chatId: string;
  enabled: boolean;
}
const EMPTY: OwnerAlertConfig = { token: "", chatId: "", enabled: false };

function configPath(dataDir: string): string {
  return join(dataDir, "owner-alerts.json");
}

export function readOwnerConfig(dataDir: string): OwnerAlertConfig {
  try {
    const p = configPath(dataDir);
    if (!existsSync(p)) return { ...EMPTY };
    const j = JSON.parse(readFileSync(p, "utf8")) as Partial<OwnerAlertConfig>;
    return {
      token: typeof j.token === "string" ? j.token : "",
      chatId: typeof j.chatId === "string" ? j.chatId : "",
      enabled: !!j.enabled,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeOwnerConfig(dataDir: string, cfg: OwnerAlertConfig): void {
  const p = configPath(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  // Atomic write (temp + rename) so a reader never sees a half-written file (which
  // would silently read as EMPTY = alerts disabled).
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  renameSync(tmp, p);
}

/** Send a message to the owner's Telegram chat. Uses the global fetch (no undici). */
export async function sendOwnerTelegram(
  token: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000), // never let a hung socket stall the monitor
    });
    return res.ok;
  } catch {
    return false;
  }
}
